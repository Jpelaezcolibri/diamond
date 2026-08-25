# Radar: mandatos de compra y cruce contra las ofertas de los colegas

**Fecha:** 2026-08-25
**Estado:** diseño aprobado por Juan (2026-08-25)
**Pedido por:** Juan

## 1. Qué se quiere y por qué

Diamond tiene clientes **compradores** cuyo requerimiento no está en el inventario
propio ni en la red de aliados registrada. Hoy esos clientes se atienden a pulso:
alguien lee los grupos gremiales y se acuerda de que había un cliente esperando eso.

Se quiere que el radar, que ya escucha esos grupos, cruce **cada oferta que publica
un colega** contra una lista curada de mandatos de compra, y le mande el match al
asesor dueño del mandato con todo lo necesario para llamar al colega: teléfono,
ficha, grupo, qué cumple y qué falta verificar.

El detonante fue un cruce manual del 2026-08-25 sobre las 329 ofertas ya capturadas,
contra 4 compradores reales de Natalia:

| Cliente | Coincidencias | Nota |
|---|---|---|
| 1 · Apto ≤$600M, 3 hab, CdRío/Guayabal/Palmas/Laureles | 5 (+4 apenas encima) | Cero oferta en Ciudad del Río bajo $600M |
| 2 · ≤$2.200M, +150 m², 4 hab, cerca al CC Tesoro | 7 (2 fuertes) | El mejor cruce; 1 con teléfono ya resuelto |
| 3 · Arriendo amoblado Poblado 2h/2b ~$8M/mes | 0 | Los grupos escuchados son de venta |
| 4 · Consultorio médico Torre Médica Tesoro/Oviedo | 0 | Ni una mención en 329 ofertas |

**12 oportunidades reales en 2 días de captura, encontradas a mano.** Eso es lo que
se automatiza. Y los dos ceros son el dato de producto: no faltó motor de cruce,
faltaron los grupos correctos encendidos (§7).

## 2. Los dos carriles, y por qué son asimétricos

```
VENDEMOS — un colega PIDE algo que Diamond tiene        [YA EXISTE, no se toca]
  ¿tengo su teléfono + es su primer pedido del día + hay cupo de ritmo?
    SÍ → DM automático AL COLEGA por la línea del radar, un solo mensaje
         con todos los matches + link a la línea oficial de Sofi
    NO → pasa a CATHERINE, con el mensaje ya redactado para pegar
  sin match publicable → CATHERINE
  en el grupo → NADA, nunca

COMPRAMOS — un colega OFRECE algo que cruza un mandato   [ESTE DISEÑO]
  → DM directo a NUESTRO ASESOR (el dueño del mandato). Sofi NO le escribe
    al colega. El asesor lo contacta.
  si el aviso no se pudo entregar → pasa a CATHERINE
  en el grupo → NADA, nunca
```

La asimetría es deliberada, por dos razones independientes:

**Riesgo.** Cuando vendemos, el colega pidió: un DM es la conducta que él espera y
estamos ofreciendo lo nuestro. Cuando compramos, el colega publicó al grupo y no nos
pidió nada — un DM automático ahí es un mensaje frío sobre una propiedad ajena, que
es el patrón que más reportes de baneo tiene (ver `src/lib/waha.js`).

**Comercio.** Negociar la propiedad de otro y acordar el reparto de comisión lo tiene
que hacer una persona. El sistema no reparte comisiones (regla de Juan): quien pone el
cliente y quien pone la propiedad se ponen de acuerdo entre ellos.

Se hereda el principio que ya rige el carril de venta (Juan, 2026-08-20: *"lo que no
se responda por el bot debe ir de una al chat, no podemos dejar pasar ningún
pedido"*): **ningún match termina sin acción.** Los límites desvían, no descartan.

## 3. Lo que se reutiliza (y por lo tanto no se construye)

| Pieza existente | Para qué sirve acá |
|---|---|
| `src/groups/classify.js` | Interpretar el brief que reenvía el asesor y las ofertas del grupo |
| `src/groups/match.js` → `evaluarCandidata` | El motor de puntaje: zona graduada, precio, habitaciones, área, baños, garajes, estrato, `flexible_habitaciones` |
| `src/groups/directorio.js` | Resolver LID → teléfono del colega (67% medido en producción) |
| `src/channels/whatsapp.js` → `sendTemplate` | Entregar el aviso fuera de la ventana de 24 h |
| `ally_properties` + `ally_property_alerts` | Archivo de la oferta y patrón de dedup |
| `src/scheduler/radar-recordatorio.js` | Reintento de avisos no entregados |
| Panel del radar en el CRM | Ver mandatos, matches y pendientes |
| `engine.js` — detección de asesora por teléfono | Que Sofi atienda a Natalia como asesora y no le abra un lead falso |
| `registrar_resultado_radar` | Cerrar el circuito con la respuesta del asesor |

## 4. Componentes nuevos

### 4.1 Tabla `mandatos_compra`

El "espacio para los clientes que tenemos para comprar". Copia deliberada del shape
de un pedido del radar (`group_signals`), porque un mandato **es** un pedido — solo que
nuestro. Así `evaluarCandidata` lo consume sin traducción, que es exactamente el bug
que documenta `filtrosInventario` cuando dos módulos nombran distinto lo mismo.

```
id, org_id
cliente_nombre, cliente_telefono          -- de quién es el mandato
advisor_id                                -- A QUIÉN se le avisa (no se infiere)
operacion                                 -- venta | arriendo
tipo                                      -- apartamento | casa | consultorio | ...
zonas jsonb, zonas_excluidas jsonb
precio_max, precio_min
habitaciones, flexible_habitaciones bool
area_min, banos, garajes, estrato
exigencias jsonb                          -- texto libre: "balcón", "gym",
                                          --   "lavadora y secadora", "moderna"
plazo                                     -- "3 a 6 meses" (arriendo temporal)
texto_original                            -- el brief tal como llegó
notas
estado                                    -- activo | pausado | cerrado
created_at, updated_at
```

`texto_original` no es adorno. Es lo que permitió detectar el 2026-08-24 que el
clasificador estaba recortando el pedido de un colega (migración
`group_signals_exigencias`). Un mandato mal leído filtra mal para siempre y no avisa.

`advisor_id` es explícito y no se deriva de quién escribió: un mandato de Natalia
puede pasar a otro asesor sin tocar el registro de quién lo cargó.

Migración en `db/migrations/2026-08-25_mandatos_compra.sql`, a correr a mano en
Supabase (este repo no tiene `db:push`). RLS igual que `ally_properties`: lectura para
el equipo autenticado, escrituras por `service_role`.

### 4.2 Tabla `mandato_match_alerts`

Dedup y auditoría: `unique (mandato_id, ally_property_id)`. Un aviso por par y nunca
más. Mismo patrón que `ally_property_alerts`.

Hace falta de verdad: el 2026-08-25 la casa del Mall Tesoro aparecía **dos veces** en
la captura, publicada dos veces por la misma persona. Sin dedup, son dos avisos
idénticos y Natalia empieza a ignorar los avisos.

Guarda además `entregado` (bool), `entregado_at`, `escalado_a_catherine_at` — es lo que
alimenta la lista de pendientes del CRM y el reintento.

### 4.3 Tool `registrar_mandato_compra`

Se agrega **en los dos lados**: `src/agent/tools.js` (WhatsApp, donde `engine.js` ya
reconoce a la asesora por teléfono) y `src/agent/sofi-comando-tools.js` (chat del CRM).

Natalia le reenvía a Sofi el brief tal como se lo pasó el cliente. Sofi lo clasifica
con `classify.js`, lo guarda, y **responde qué entendió campo por campo** para que ella
corrija en el mismo chat:

```
Listo, guardé el mandato de Marcela Restrepo:
· Compra apartamento o casa, hasta $2.200 millones, pago de contado
· Mínimo 150 m², 4 habitaciones (o 3 + servicio/estudio)
· Poblado cerca al CC Tesoro, o Palmas parte baja
· Debe tener: balcón, buena vista, ser moderna, unidad con zonas sociales
¿Corrijo algo?
```

Esa confirmación es obligatoria, no cortesía: sin ella, un mandato silenciosamente mal
leído es el peor bug posible del sistema — filtra mal para siempre y nadie se entera.

### 4.4 `src/groups/cruce-mandatos.js`

El corazón. Se engancha donde hoy corre `cruce-leads.js`, sin reemplazarlo: los dos
cruces son complementarios (`cruce-leads` mira los leads del bot, este mira los
mandatos curados).

```
oferta clasificada
  → guardarOferta()                     (ally_properties, como hoy)
  → mandatos activos de la org
  → evaluarCandidata(oferta, mandato)   por cada mandato
  → los que pasan el piso (§4.5)
  → dedup contra mandato_match_alerts
  → resolver LID → teléfono (directorio)
  → armar aviso y enviar al advisor_id del mandato
```

Un módulo, una responsabilidad, testeable sin base ni red: `evaluarCandidata` ya es
código puro y el envío se inyecta, igual que en `cruce-leads.js`.

**Se rompe una decisión vieja, a propósito:** `ofertas.js` hoy no resuelve el LID
porque "corre en un contexto sin I/O al directorio". El cruce sí lo resuelve, al armar
el mensaje. Sin teléfono el aviso pierde la mitad de su valor. Se resuelve en el cruce
y no en `ofertas.js` para no meterle esa dependencia al módulo que solo archiva.

### 4.5 El piso del filtro

Decisión de producto (Juan, 2026-08-25): **filo bajo, salvedades escritas.** Natalia
decide qué sirve; el sistema no descarta por ella. Pero hay un piso, porque un aviso
que Natalia aprende a ignorar es peor que no mandarlo:

**Duro (si falla, no se manda):**
1. **Operación** igual. Nunca mandar un arriendo a quien compra.
2. **Zona** pedida o vecina, según la graduación que ya tiene `ubicacionCoincide`.
3. **Precio** no más de **15%** arriba del tope.

**Blando (se manda, con la salvedad escrita):** habitaciones, área, baños, garajes,
estrato, exigencias de texto libre.

Perilla `RADAR_MANDATO_MAX_DIA` (default `0` = sin límite), mismo criterio que
`maxPorGrupoDia` en `politica.js`: si Natalia se ahoga, se pone un número y se calma
sin tocar código.

### 4.6 El aviso al asesor

```
🎯 Oferta nueva que le sirve a Marcela Restrepo (mandato #2)

Dúplex en venta — Loma del Tesoro, El Poblado
$1.580.000.000 · 246 m² · 4 alcobas · 3 baños · 2 garajes · estrato 6
Ficha: https://glovi.co/inmueble/9829914

Colega: Glovi l Propiedad raíz
Teléfono: +57 324 415 1819
Visto en: SOLO VIVIENDA >$1000 MLLS · hoy 10:42 a.m.

Cumple: sector (Loma del Tesoro), presupuesto ($620M por debajo del tope),
4 habitaciones, área (246 de 150 pedidos).
Sin verificar: vista, balcón, zonas sociales de la unidad, si es moderna.

Confirmá disponibilidad antes de mostrárselo al cliente.
La comisión se comparte: quien tiene el cliente y quien tiene la propiedad
se ponen de acuerdo.

Contame cómo te fue con una respuesta corta.
```

Cuatro decisiones, cada una con su razón:

- **"Cumple / Sin verificar" en vez de un puntaje.** Un "87%" no le dice a Natalia qué
  preguntarle al colega; *"sin verificar: vista y balcón"* sí. Misma lógica de
  salvedades del commit `112defe`.
- **Nunca dice "está disponible".** El radar vio un mensaje en un grupo; no verificó
  nada. La instrucción de confirmar va en el cuerpo, no como nota al pie. Una oferta
  recomendada como disponible cuando no lo está es el daño de reputación que la
  caducidad de `ally_properties` existe para evitar.
- **Sin teléfono (el 33%)** esa línea cambia a: *"El colega no dejó número visible —
  abrí su chat tocando el nombre 'Glovi l Propiedad raíz' en el grupo SOLO VIVIENDA
  >$1000 MLLS"*. Desde el celular funciona sin el número (`tocarNombreEnGrupo`), y por
  eso ese tercio tiene salida real y no es un aviso muerto.
- **La respuesta corta que pide al final** hace dos trabajos: registra qué pasó
  (`registrar_resultado_radar`) y **renueva la ventana de 24 h de Meta**, que es lo que
  mantiene el canal abierto para el próximo match.

### 4.7 Entrega: plantilla Meta + pendientes

Meta solo entrega texto libre a quien escribió en las últimas 24 h, y **los mensajes
de Sofi no renuevan ese plazo, solo los de ella**. Sin resolver esto, el match perfecto
de un martes a las 3 p.m. no llega.

```
intentar texto libre
  ├── entra → listo, marcar entregado
  └── ventana cerrada (error 470/131047 de Meta)
        → plantilla "radar_match_mandato" (entra siempre)
        → cuando Natalia responde, se abre la ventana y sale el detalle completo
        → si la plantilla también falla → escalar a CATHERINE
```

Plantilla a crear en Meta (categoría `UTILITY`), 3 variables:

```
Nueva oferta de un colega que le sirve a {{1}}: {{2}} en {{3}}.
Respondé a este mensaje y te paso el detalle completo con el contacto.
```

`{{1}}` cliente, `{{2}}` tipo + precio, `{{3}}` zona. Sin link ni teléfono en la
plantilla: el detalle va por texto libre una vez abierta la ventana, y así el contenido
sensible no queda en un mensaje que Meta revisa.

**Escalado a Catherine (Juan, 2026-08-25): solo si no se pudo entregar.** Si el aviso
llegó y Natalia no contestó, es asunto de ella — el mandato tiene dueño. Catherine
entra únicamente cuando el mensaje no llegó, y lo recibe con la marca de por qué se le
escaló a ella.

### 4.8 Lo que NO se toca

- **`politica.js` y el carril de venta.** Funcionan y ya hacen lo que Juan describió.
- **Publicar en grupos.** Sigue apagado y este diseño no lo enciende nunca. El permiso
  `responde` de cada grupo se queda en `false`.
- **`cruce-leads.js`.** Sigue corriendo. Este cruce se suma, no lo reemplaza.
- **La línea vinculada del radar** sigue sin conversar 1 a 1 en el carril de compra.

## 5. Los 4 mandatos iniciales

Se cargan por el flujo normal (Natalia se los reenvía a Sofi), no por SQL: es la
primera prueba real de `registrar_mandato_compra` y de la confirmación campo por campo.

| # | Cliente | Requerimiento |
|---|---|---|
| 1 | (por definir) | Compra apto, ≤$600M, 3 hab · Ciudad del Río, Urbanity, Guayabal, Palmas, Laureles |
| 2 | (por definir) | Compra casa/apto, ≤$2.200M contado, +150 m², 4 hab (o 3+servicio/estudio), balcón, vista, moderna, unidad con zonas sociales · Poblado cerca CC Tesoro, Palmas parte baja |
| 3 | (por definir) | Arriendo amoblado ~$8M/mes, 3 a 6 meses, 2 hab / 2 baños, buena vista, gym, zonas húmedas, lavadora y secadora, lavaplatos · El Poblado |
| 4 | (por definir) | Compra consultorio médico · Torre Médica El Tesoro, Torre Médica Oviedo |

Los nombres de cliente los pone Natalia al cargarlos.

## 6. Datos de producción que sostienen este diseño

| Medición | Valor | Fuente |
|---|---|---|
| Ofertas de colegas capturadas | 329 (321 venta, 8 arriendo) | `group_signals`, 18–20 ago 2026 |
| Ofertas archivadas en `ally_properties` | 304 con `origen='grupo'` | consulta 2026-08-25 |
| Grupos escuchando (`modo≠ignorar`) | 14 de ~120 | `whatsapp_groups` |
| LID → teléfono resuelto | 6 de 40 colegas registrados | `colegas_grupos` |
| LID → teléfono resuelto en vivo | 30 de 45 = 67% | medición 2026-08-22 |
| Volumen esperado con 14 grupos | ~150 ofertas/día | 329 en ~2 días |

De ahí sale que el volumen es manejable: 12 matches sobre 329 ofertas con 4 mandatos
exigentes ≈ 3-4% de tasa de cruce.

## 7. Los interruptores, y qué depende de Juan

Nada de esto lo puede hacer Claude — requiere accesos que no tiene.

1. **Levantar WAHA y vincular la línea.** Sin esto no entra ninguna oferta. La regla no
   se negocia: la línea tiene que ser **secundaria de la empresa y sacrificable**, nunca
   la de un asesor con clientes ni la de Sofi. Existe porque en julio de 2026 WhatsApp
   baneó la línea de una asesora con este mismo montaje — y ese montaje solo leía.
2. **`GROUPS_ENABLED=true`** en Railway, con `GROUPS_WEBHOOK_SECRET` puesto.
3. **Crear la plantilla `radar_match_mandato`** en Meta (texto en §4.7).
4. **Correr las migraciones** en Supabase: las dos nuevas de este diseño, más las tres
   que ya estaban pendientes (`2026-08-18_radar_aviso_destinatario`,
   `2026-08-24_group_signals_exigencias`, `2026-07-09_dmap_default_designer`).
5. **Encender los grupos que faltan** desde el panel del CRM. Los 14 actuales no cubren
   dos de los cuatro clientes — de ahí los dos ceros de §1:

| Para | Grupos a encender (hoy en `ignorar`) |
|---|---|
| Cliente 3 (amoblado) | Ofertas ARRIENDO · Arriendos F y A amoblados · RENTA AMOBLADOS/FINCAS · RENTA Y VENTA AMOBLADOS MEDELLIN · Renta y Venta Amoblados y Airbnb · Rentas Cortas y Coliving · Ribautt Amoblados |
| Cliente 4 (consultorio) | USO COMERCIAL 7 AM - 8 PM · Locales y oficinas · Bodegas, Oficinas, locales · OFICINAS ANDRÉS NIETO |
| Clientes 1 y 2 | OFERTAS SUR POB ENV SAB · Ofertas Poblado Envigado · OFERTAS 7:00 A.M.8:00P.M. · Ofertas VENTA 1000 |

Encender la **escucha** (`modo`) es seguro y es todo lo que hace falta. El permiso de
**publicar** (`responde`) se queda apagado en todos.

## 8. Pruebas

Runner: `node --test test/` (sin frameworks, patrón de `test/group-cruce-leads.test.js`).

**`test/mandatos-compra.test.js`**
- Un brief con exigencias de texto libre se guarda con `exigencias` completas y
  `texto_original` intacto — el bug de `group_signals_exigencias`, en su versión nueva.
- Un brief sin precio no se guarda como `precio_max = 0` (que matchearía todo).
- La confirmación que devuelve Sofi menciona cada campo que guardó.

**`test/group-cruce-mandatos.test.js`**
- Oferta de arriendo contra mandato de compra → **no se manda**.
- Oferta 16% por encima del tope → no se manda; 14% → se manda con salvedad.
- Oferta en zona vecina → se manda, con la zona marcada como vecina.
- Oferta que cumple todo salvo el área → se manda y el texto dice qué falta.
- Mismo par (mandato, oferta) dos veces → un solo aviso.
- Colega sin teléfono resuelto → el aviso trae la instrucción de tocar el nombre en el
  grupo, y **no** un teléfono inventado ni un LID disfrazado de número.
- El aviso va al `advisor_id` del mandato, no al primer asesor con
  `recibe_transferencias`.
- Ventana cerrada → se intenta la plantilla; plantilla fallida → se escala a Catherine
  y queda marcado.
- Entregado bien → **no** se escala a Catherine.

**Regresión, obligatoria:** la suite del carril de venta (`group-politica`,
`group-publicable`, `group-dm`, `group-asistido`) tiene que seguir verde. Este diseño
no puede cambiar ni un byte de ese comportamiento.

## 9. Riesgo, dicho sin adornos

- **WAHA sigue siendo un cliente no oficial.** Este diseño no agrega riesgo al carril
  de compra (solo lee el grupo y manda un DM por la línea **oficial** de Sofi a una
  asesora propia), pero tampoco lo reduce. La línea puede ser baneada en cualquier
  momento y hay que poder perderla sin perder el negocio: por eso los contactos con los
  que hubo trato quedan respaldados en `colegas_grupos`.
- **El 33% sin teléfono no se arregla.** WhatsApp no da ese dato. Se atiende con una
  persona y una instrucción clara, no con un workaround.
- **Filo bajo tiene un costo.** Si el volumen molesta, la perilla de §4.5 existe. Lo que
  no se hace es subir el piso en silencio: los falsos negativos son invisibles por
  definición y son los caros.
- **Un mandato mal leído envenena su carril entero** y no se queja. La confirmación
  campo por campo y `texto_original` son la defensa; no hay una segunda.

## 10. Decisiones tomadas (Juan, 2026-08-25)

| Decisión | Elegido | Descartado |
|---|---|---|
| Qué le llega a Catherine | Pedidos de colegas que Diamond puede atender (carril de venta) | Copia de todo / mandatos propios |
| Carga de mandatos | Natalia se los reenvía a Sofi por WhatsApp | Formulario en el CRM |
| Filo del cruce | Bajo: todo lo que se acerque, con salvedades escritas | Solo lo que cumple todo o falla en 1 |
| Ritmo | Al instante | Resumen 2 veces al día |
| Entrega | Plantilla Meta + pendientes como red | Solo texto libre / abrir ventana a mano |
| Respaldo en compra | Catherine solo si no se pudo entregar | A las 2 h sin reacción / nunca |
| DM al colega en compra | No. Va directo al asesor propio | DM automático al colega |

## 11. Lo que este diseño NO resuelve

- **No consigue oferta que no existe.** Los ceros de los clientes 3 y 4 se resuelven
  encendiendo grupos (§7) y publicando el pedido, no con mejor código.
- **No verifica disponibilidad ni precio.** Sigue siendo trabajo de la persona que
  llama. El sistema es explícito al respecto en cada aviso.
- **No reparte comisiones.** Regla de negocio: quien pone el cliente y quien pone la
  propiedad lo acuerdan entre ellos.
- **No publica el pedido en los grupos.** Sofi no escribe en ningún grupo, y este
  diseño no cambia eso. Publicar los mandatos huérfanos es una decisión aparte.
- **No toca el `metrics.worker` de DMAP**, que sigue fallando (known issue P2).
