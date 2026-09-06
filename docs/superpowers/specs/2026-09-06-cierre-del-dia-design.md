# Cierre del día — el radar le pregunta a la asesora por PROPIEDADES, no por pedidos

**Fecha:** 2026-09-06
**Estado:** aprobado por Juan (formato, alcance y hora decididos el mismo día)
**Reemplaza:** `src/scheduler/radar-recordatorio.js` como canal de cobro del resultado

---

## El problema, con el mensaje real que lo disparó

Natalia recibió esto dos veces el 5 de septiembre:

> Natalia, ¿en qué quedó el pedido de "Buenas tardes Quién tiene lotes para
> construir bodega en zona franca Rionegro Sólo directa 50/50 Has..." que te
> avisé hace un rato?
>
> Contame así sea corto por cada uno (le escribí / no servía / hubo visita /
> se cerró) — con eso el radar aprende.
>
> Es muy importante que respondas para poder seguir contando con el radar.

Juan: *"el asesor no sabe de qué propiedad están hablando"*.

Tiene razón, y la causa es concreta. `radar-recordatorio.js#resumenPedido` cita
**`texto_original`**, que es lo que escribió el colega en el grupo. La asesora
no gestiona pedidos ajenos: gestiona **sus propiedades**, y las identifica por
referencia. Le estamos pidiendo que recuerde el texto de un tercero.

El dato que sí le sirve ya está guardado. Cada señal trae nuestras referencias
con título y zona:

| Señal | Lo que citamos hoy | Lo que ella reconoce |
|---|---|---|
| 05-sep 13:36 | "*_PEDIDO 1_* SE BUSCA APARTAMENTO EN VENTA — EL POBLADO Sectores: Zúñiga..." | 10316178 · Apto Otraparte, Envigado |
| 05-sep 13:59 | "📌Casa en unidad de Loma de los Bernal o La Mota, mínimo 3 alcobas..." | 10012896 · Casa La Mota |

Hay un segundo problema, más caro. Los pedidos que **Sofi ya le mandó al
colega** por privado nunca entran al circuito: `pendientesDeAviso` exige
`respondida_at is null`, así que quedan fuera del pool. En septiembre salieron
54 mensajes y hay **1 solo resultado registrado**. El radar no está aprendiendo
casi nada, y el 82 % de lo que se movió jamás se pregunta.

## Qué se construye

Un **cierre del día**: un solo mensaje, a las 18:30 hora Colombia, que lista
las propiedades de la asesora que se movieron ese día y le pide el resultado
de cada una por número.

```
Natalia, cierre del día. Estas 4 propiedades tuyas se movieron hoy:

1) 10316178 · Apto Otraparte, Envigado — Gustavo Arango
2) 9921388 · Apto Santa Ana, Balsos — Gustavo Arango
3) 10012896 · Casa La Mota — Adriana Gutiérrez
4) 9935585 · Apto Fontanar, Poblado — Deisy Marín

Respondeme con el número y en qué quedó.
Ejemplo: "1 no servía, 3 hubo visita"
```

Decisiones que tomó Juan y que no se reabren acá:

- **Formato: lista numerada por WhatsApp.** Se descartó la página con botones,
  aunque `crm/app/aviso/[token]` ya existía y se podía extender. Efecto lateral
  bueno: que ella **escriba** reabre la ventana de 24 h de WhatsApp; tocar un
  link no la reabre.
- **Alcance: todo lo que se movió.** Las que ella tuvo que decidir y también
  las que Sofi le mandó sola al colega. Es el arreglo del 82 % que hoy no se
  pregunta.
- **Hora: 18:30.** Días sin movimiento no mandan nada.

## Arquitectura

Cuatro piezas, cada una con un trabajo:

| Pieza | Archivo | Responsabilidad |
|---|---|---|
| Datos del cierre | `src/data/radar-cierres.js` | Guardar y leer la numeración enviada |
| Armado del texto | `src/groups/cierre-dia.js` | De señales a lista numerada. Puro, testeable sin base |
| Disparo diario | `src/scheduler/cierre-dia.js` | Una corrida por día, reclamo atómico, envío |
| Cobro de la respuesta | `registrar_resultados_cierre` en `src/agent/tools.js` | De "1 no servía, 3 visita" a `signal_events` |

### Por qué una tabla nueva y no derivar la lista otra vez

El número tiene que significar **lo mismo cuando ella responde** que cuando se
envió. Si la lista se vuelve a calcular al recibir la respuesta, cualquier
señal que entre entre las 18:30 y su contestación corre la numeración y
registramos el resultado sobre la propiedad equivocada. Eso es peor que no
registrar nada, y es el mismo error que `registrarResultadoRadar` ya evita
negándose a adivinar cuando hay varios pendientes.

Se agrega `radar_cierres`, una fila por asesora por día:

```sql
create table if not exists radar_cierres (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  advisor_id uuid not null references advisors(id),
  fecha date not null,
  items jsonb not null,          -- [{n, signal_id, ref, titulo, colega}]
  enviado_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, advisor_id, fecha)
);
```

El `unique` es el reclamo atómico: dos ticks del mismo día no pueden mandar dos
cierres. Mismo patrón que `claimRecordatorio`.

### Qué entra en el cierre

Para cada asesora, las señales de HOY que:

1. le llegaron como aviso para decidir (`aviso_advisor_id` = ella, `enviado_at`
   no nulo), **o** salieron por DM al colega (`respondida_at` no nulo,
   `respuesta_modo` = 'auto'), en cuyo caso pertenecen a la asesora principal
   del radar (`advisors.findAsesorPrincipalRadar`);
2. **no** tienen ya un resultado en `signal_events`.

La segunda condición usa `signalEvents.ultimoPorSenal`, igual que
`candidatosDeOrg`. La dirección de dependencia se respeta: Radar lee al
Learning Domain, nunca al revés.

### De qué propiedad hablamos

Por señal se elige **una** referencia, en este orden:

1. `respuesta_refs` — lo que de verdad salió en el DM al colega
2. `revalidacion.refs_utiles[0]`
3. `revalidacion.refs_dudosas[0]`
4. el `matches` de mayor puntaje

El título y la zona salen de `matches` cruzando por `ref`. Si una señal no
tiene ninguna referencia, **no entra al cierre**: preguntar por una propiedad
que no podemos nombrar es volver al problema que esto arregla.

Una señal puede haber movido varias propiedades. Se lista **una por señal**,
la que se ofreció, porque el resultado que buscamos es el de esa gestión. La
referencia elegida queda guardada en `items` para que el registro sea auditable.

### El cobro de la respuesta

Herramienta nueva, `registrar_resultados_cierre`, que recibe una lista de
`{numero, resultado, motivo?}`. Resuelve cada número contra el último cierre de
esa asesora (ventana de 3 días) y llama `signalEvents.registrar`.

Mapeo de lo que ella dice a los tipos que ya existen:

| Ella dice | Tipo |
|---|---|
| le escribí, no me contestó, sin respuesta | `SIN_RESPUESTA` |
| hablamos, me contestó, quedó de mirarlo | `CONVERSACION` |
| hubo visita, la vio | `VISITA` |
| está negociando, hizo oferta | `NEGOCIACION` |
| se cerró, se vendió | `CIERRE` |
| se cayó, se perdió, ya se vendió con otro | `PERDIDO` |
| no servía, no aplicaba | `DESCARTADO` |

`registrar_resultado_radar` **se queda** para el caso conversacional suelto
("ya llamé al de Sabaneta"). La nueva es para responder un cierre por números.

Si un número no existe en el cierre, se dice y no se registra nada. Falla
cerrado, como el resto del radar.

## Qué se apaga

`radar-recordatorio.js` deja de mandar: `RADAR_RECORDATORIO_ENABLED` pasa a
`false` por defecto. El código se queda, porque el cierre del día es lo no
probado y volver atrás tiene que costar una variable de entorno, no un revert.

## Riesgos

- **La ventana de 24 h.** Un cierre a las 18:30 solo se entrega si la ventana
  está abierta. Si ella no escribió en el día, el mensaje falla y ese día se
  pierde. No se reintenta, por lo mismo que ya documenta `radar-recordatorio`:
  la única forma de reabrirla es que ella escriba. El `enviado_at` de
  `radar_cierres` queda nulo, así que se ve.
- **Sofi interpretando texto libre.** "1 no servía, 3 hubo visita" lo parsea el
  modelo. El riesgo se acota en el código, no en el prompt: la herramienta
  valida que el número exista y que el tipo esté en `TIPOS`, y rechaza lo que
  no calce.
- **Listas largas.** Un día con 20 propiedades es un mensaje incómodo. Se topa
  en 10 y se dice cuántas quedaron fuera; las que no entran vuelven mañana
  porque siguen sin resultado.

## Cómo se verifica

- Tests de armado de texto sin base: numeración, elección de referencia, tope
  de 10, día sin movimiento no manda.
- Tests de la herramienta: número inexistente, tipo inválido, varios resultados
  en un mensaje, cierre viejo fuera de ventana.
- Contra producción, en seco: armar el cierre del 5 de septiembre y confirmar
  que lista las 20 propiedades reales con sus referencias, sin enviarlo.
