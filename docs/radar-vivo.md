# Radar en vivo — operación

Escucha de grupos gremiales por una línea vinculada, y respuesta automática
dentro del grupo. Este documento es para operarlo, no para entenderlo: el
diseño y el porqué están en los comentarios de cada módulo y en
[diamond-os/deep-dive-group-gateway-2026-08.md](../diamond-os/deep-dive-group-gateway-2026-08.md).

## Los dos carriles

El radar tiene dos modos de cruce: venta de lo que Diamond tiene (respuesta
automática en el grupo) y compra de mandatos registrados (aviso privado al asesor).

```
VENDEMOS — un colega PIDE algo que Diamond tiene
  ¿tengo su teléfono + es su primer pedido del día + hay cupo de ritmo?
    SÍ → DM automático AL COLEGA por la línea del radar
         un solo mensaje con todos los matches + link a Sofi
    NO → pasa a CATHERINE, con el mensaje redactado para pegar
  sin match publicable → CATHERINE
  en el grupo → NADA, nunca

COMPRAMOS — un colega OFRECE algo que cruza un mandato
  → DM directo a NUESTRO ASESOR (dueño del mandato)
     Sofi NO le escribe al colega; el asesor lo contacta.
  si el aviso no se pudo entregar → pasa a CATHERINE
  en el grupo → NADA, nunca
```

### Operación del carril de compra

Natalia (asesora cliente) le reenvía a Sofi por WhatsApp el pedido de su
cliente comprador textual — por ejemplo, "*Apto Laureles, 80-120m², 2-3
alcobas, máximo $550M, con parqueadero, piso 15+*".

Sofi lo guarda con la tool `registrar_mandato_compra` y responde confirmando
campo por campo: operación, tipo, rango de precio, área, habitaciones, zonas
preferidas, exigencias. Natalia puede corregir en el mismo chat; Sofi revalida
en cada mensaje.

Desde ese momento, **cada oferta de un colega que se ajuste al mandato genera
un WhatsApp automático directo a Natalia**. El aviso incluye:

- Teléfono del colega (cuando WhatsApp lo deja ver desde el grupo)
- Ficha completa de la propiedad
- El grupo de dónde vino el aviso
- Qué del mandato cumple y qué falta verificar

Si el aviso no se puede entregar a Natalia (ventana de 24h cerrada y la
plantilla de Meta también falla, o el mandato no tiene asesor con teléfono),
se escala automáticamente a Catherine. Ese match queda visible en el panel del
CRM, en `/grupos`, sección "Matches sin entregar" (solo para administrador), y
Catherine puede contactar al asesor por otros medios.

## Lo que hay que saber antes de encenderlo

**WAHA es un cliente NO oficial de WhatsApp.** El 2026-07-30 WhatsApp baneó la
línea de una asesora con este mismo montaje, y ese montaje **solo leía**. Lo que
se sanciona es el cliente, no la conducta: no existe una configuración "prudente"
que vuelva esto seguro. Responder en el grupo, que es lo que hace ahora, es
**más** riesgoso que aquello, no menos.

Lo único que protege es que la línea sea sacrificable.

| Línea | ¿Se puede vincular? |
|---|---|
| Secundaria de la empresa, sin clientes | **Sí** — es la única válida |
| La de Sofi (Cloud API) | **No.** Técnicamente imposible, y rompería la integración oficial |
| La de Catherine o cualquier asesor | **No.** Es la operación comercial |
| La de un cliente | **No** |

Se anota en `whatsapp_sessions.rol`. Si algún día hay que romper esta regla,
la función no se construye.

## Los tres interruptores, del más duro al más blando

1. **`GROUPS_WEBHOOK_SECRET` vacío** → el canal no se monta. La ruta no existe
   en el proceso.
2. **`GROUPS_ENABLED` ≠ `"true"`** → igual, y además los cuatro endpoints que
   hablan con WAHA responden `423`. *Este es el que faltaba en julio:* frenaba
   el webhook pero dejaba abierto "Vincular línea", así que un clic podía
   re-parear el número mientras Meta revisaba la cuenta suspendida.
3. **`GRUPOS_RESPUESTA_MODO`** → tres modos, de menos a más expuesto:
   `sombra` redacta y registra sin publicar; **`asistido`** no publica nada pero
   Sofi revalida y le avisa a la asesora; `auto` publica en el grupo. Cualquier
   otro valor apaga la respuesta. En los tres se sigue escuchando.

Y dos permisos por grupo, independientes: `modo ≠ 'ignorar'` para escuchar,
`responde = true` para publicar. **Ambos nacen apagados.** Importar una línea
trae todos sus grupos de golpe — la asesora de julio tenía 80.

## El modo asistido (calibración)

Es el modo con el que se arranca. **No se publica nada en ningún grupo** — de
hecho ni siquiera hace falta habilitar *Responder*, basta con *Escuchar*.

El flujo: llega un pedido → el motor cruza contra el inventario → **Sofi revalida
todas las candidatas** (también las de puntaje bajo) → si aprueba, le escribe a
la asesora con el grupo, el colega y su teléfono, lo que pidió textual, qué
propiedad le sirve y por qué.

Sofi ve las de puntaje bajo a propósito: es la única forma de descubrir que el
umbral está dejando pasar oportunidades buenas. Los falsos negativos son
invisibles por definición y son los caros. Cuando Sofi no coincide con el
puntaje se le pide que lo diga, y eso queda en `revalidacion.desacuerdo_con_puntaje`.

**Qué mirar para calibrar**, pasadas unas semanas:

```sql
select
  (m->>'ref') as ref,
  (m->>'puntaje')::int as puntaje,
  revalidacion->>'sirve_alguna' as sofi_aprueba,
  revalidacion->>'desacuerdo_con_puntaje' as desacuerdo
from group_signals, jsonb_array_elements(matches) m
where revalidacion is not null
order by created_at desc;
```

Si Sofi aprueba consistentemente cosas por debajo de 70, el umbral está alto. Si
rechaza cosas por encima de 80, está bajo o los pesos están mal repartidos.

**La ventana de 24 h.** Meta solo entrega texto libre a quien escribió en las
últimas 24 horas, y **los mensajes de Sofi no renuevan ese plazo — solo los de
ella**. Por eso el aviso termina pidiendo una respuesta corta: registra qué pasó
con la oportunidad y de paso mantiene el canal abierto. Si aun así la ventana
está cerrada, el aviso **no se marca enviado** y queda pendiente.

## Si la sesión se cae

**No se levanta sola, a propósito.** No hay reintento automático en nuestro
código y ningún worker la toca: queda caída hasta que una persona actúe.

1. `Reintentar una vez` en el panel — conserva las credenciales, no pide QR.
2. Si queda igual, **no insistas**. Mirá los logs de WAHA primero.
3. `Volver a parear (QR nuevo)` solo si WhatsApp dejó de aceptar el dispositivo
   (`FAILED` persistente): descarta las credenciales y mueve el corte temporal.

Conviene tener claro el alcance: esto controla **nuestros** reintentos. El motor
que corre dentro de WAHA tiene su propia reconexión y no se apaga desde el bot;
si hace falta frenarla del todo, se baja el servicio.

Y el matiz que importa para no protegerse de lo que no era: el 30 de julio la
secuencia fue `stream:error 503` → 60 reintentos en 5 minutos → sesión trabada →
baneo. **El 503 llegó primero**, así que los reintentos fueron consecuencia, no
causa. Quitar el bucle no es lo que evita un baneo — lo que consigue es que una
caída sea visible en vez de quedar tapada, y no seguir golpeando cuando ya
dijeron que no.

## Apagar de emergencia

Bajar el bot **no detiene WAHA**. Se comprobó en julio:
`WHATSAPP_RESTART_ALL_SESSIONS=False` tampoco — al redesplegar levanta la sesión
igual (`Restarting STOPPED session...`).

```bash
railway down --service waha
```

Y después **verificarlo en los logs, no asumirlo**. El baneo anterior se
descubrió porque Juan abrió una pantalla, no porque una alarma avisara.

Para apagar solo la respuesta sin perder la escucha, `GRUPOS_RESPUESTA_MODO=sombra`
y redesplegar. Para apagar un grupo puntual, `POST /api/grupos/responde` con
`responde: false` — no requiere deploy y funciona aunque el radar esté apagado.

## Encendido, en orden

1. Correr `db/migrations/2026-08-16_radar_vivo.sql` a mano en Supabase.
   Verificación: `select count(*) from whatsapp_groups where responde;` → `0`.
2. Levantar el servicio WAHA (motor `NOWEB`; `WEBJS` levanta Chromium y no cabe
   en el presupuesto). Sin dominio público, red privada de Railway.
3. Correr también `db/migrations/2026-08-18_radar_asistido.sql` (columna
   `revalidacion`, donde queda el veredicto de Sofi).
4. Poner `GROUPS_WEBHOOK_SECRET`, `WAHA_URL`, `WAHA_API_KEY`, `BOT_PUBLIC_URL`,
   `RADAR_WATCHDOG_TO` y `GROUPS_ENABLED=true`. Modo: `asistido`.
5. Vincular la línea por QR e importar sus grupos.
6. Habilitar **Escuchar** en uno solo. **No hace falta `responde`**: en asistido
   no se publica nada.
7. Dejarlo corriendo y revisar los avisos que le llegan a la asesora, más la
   consulta de calibración de arriba.
8. Cuando el criterio esté afinado: `sombra` para ver el mensaje que saldría al
   grupo, y solo entonces `auto` con `responde` en un grupo.

## Qué revisar en la sombra

```sql
select fecha_mensaje, texto_original, respuesta_texto
from group_signals
where respuesta_modo = 'sombra'
order by respondida_at desc;
```

La pregunta no es si el mensaje se ve bien, es si **cada dato es cierto**:
precio, área, zona y disponibilidad, contra Wasi, propiedad por propiedad. Un
dato malo publicado ante 80 competidores se ve una vez y no se borra.

Para probar sin esperar a que entre un pedido:

```bash
node scripts/preview-respuesta-grupo.js --zona laureles --max 900000000
```

## Salud

`GET /webhook/grupos/estado` (con el header `x-api-key`) devuelve el modo y los
contadores del proceso: `recibidos`, `prefiltrados`, `difundidos`, `publicados`,
`sombra`, `callados`, `errores`.

Los contadores viven en memoria y se reinician con cada deploy. Lo que sí
persiste es `group_signals`: ahí está el texto de todo lo que se publicó.

### El watchdog

Revisa cada 30 minutos y avisa por WhatsApp a los números de
`RADAR_WATCHDOG_TO`. Sin esa variable **no arranca**: un vigilante que no tiene
a quién llamar no es un vigilante.

Detecta dos cosas: que la sesión vinculada se haya caído (`FAILED`, `STOPPED`,
`ERROR`) y que el inventario esté viejo. Avisa una sola vez por problema, y
también cuando se normaliza — si no, quien recibe la alarma nunca sabe que puede
dejar de preocuparse, y termina ignorándolas.

**No intenta arreglar nada**, y hay un test que lo verifica: no puede llamar a
`reintentarUnaVez`, `revincular`, `crearSesion` ni `restart`. Detecta y avisa;
levantar la sesión es decisión de una persona.

Los avisos salen por la **línea oficial de Sofi**, nunca por la vinculada: si lo
que se cayó es esa línea, avisar por ahí sería pedirle al muerto que avise de su
muerte.

## Límites que aplica solo

| Control | Variable | Default |
|---|---|---|
| Puntaje mínimo para publicar | `GRUPOS_RESPUESTA_UMBRAL` | 70 |
| Confianza mínima del clasificador | `GRUPOS_RESPUESTA_CONFIANZA` | 0.85 |
| Tope diario por grupo | `GRUPOS_RESPUESTA_MAX_DIA` | **0 = sin límite** |
| Segundos entre publicaciones | `GRUPOS_RESPUESTA_ESPACIADO_SEG` | 20 |
| Máximo de horas sin sync | `GRUPOS_SYNC_MAX_HORAS` | 30 |
| Refs bloqueadas | `GRUPOS_REFS_BLOQUEADAS` | `9921388` |
| Margen de precio sobre el techo pedido | `GRUPOS_MARGEN_PRECIO` | 0.10 (10%) |
| Margen de área bajo el mínimo pedido | `GRUPOS_MARGEN_AREA` | 0.10 (10%) |

**Sin restricción de horario (Juan, 2026-08-20).** El radar responde 24/7. Antes
callaba fuera de 8am–7pm Colombia, y un match perfecto llegado a las 7am se
perdía para siempre sin ningún reintento cuando abría la ventana.

**Sobre el volumen.** No hay tope diario por decisión de producto: si entran mil
pedidos y para los mil hay algo que ofrecer, se responden los mil. Un tope
descarta pedidos buenos sin mejorar la calidad de lo que se publica — de la
calidad se ocupa la compuerta, no un contador.

El **"máximo 3"** son las propiedades que van *dentro* de una respuesta, no la
cantidad de respuestas. Y el espaciado **no descarta nada**: el pedido que venga
atrás espera su turno en la cola del grupo y se responde igual; lo único que
evita es disparar dos envíos en el mismo segundo.

Si el gremio reacciona mal al volumen, se pone un número en
`GRUPOS_RESPUESTA_MAX_DIA` y queda acotado sin tocar código.

Sobre el umbral: la escala de `match.js` va **de 55 a 100**, no de 0 a 100 — un
match necesita pasar operación, tipo, token exacto de zona y banda de precio
solo para existir con 55. Medido contra el inventario real el 2026-08-16, el
techo sin pedir alcobas es **73**; con el umbral en 80 el bot queda mudo.

El mismo aviso difundido a varios grupos se responde **una sola vez**
(`GROUPS_DEDUP_HORAS`, default 6). Medido el 2026-07-29: de 494 señales, 312
eran repeticiones.

## Lo que no hace, a propósito

- No responde ofertas de colegas, solo demandas.
- No publica inventario de aliados: el aliado puede estar leyendo ese grupo.
- No publica una propiedad sin precio, sin zona, sin área, no disponible, o con
  el sync viejo — ver `src/groups/publicable.js`.
- No se hace pasar por una persona: el mensaje se firma como automático.
- No reintenta un envío fallido. Un reintento ciego sobre algo que quizá sí
  salió es la forma más fácil de publicar dos veces en un grupo.
