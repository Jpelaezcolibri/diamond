# DM al colega: una propiedad por mensaje, un solo recordatorio a las 2 horas

**Decisiones de Juan, 2026-09-10.** Diseño aprobado en conversación.
**Estado (2026-09-13): §3.1 a §3.3 implementados** (rama `dm-separados`,
commits `36e1442` y `a45fac5`). **§3.4, el recordatorio, NO**: necesita la
migración y va apagado hasta que Juan diga.

Un ajuste sobre §3.1, por el caso del 2026-09-13 en el inbox de la línea: un
colega respondió "Enviame de a una propiedad Link Que se pueda pasar al posible
cliente" y después "Enviame link solo Opción 2". El saludo, la salvedad, la
comisión y la firma van en un **primer mensaje aparte**, no pegados a la ficha
1 ni a la última: pegados, esa ficha deja de poder reenviarse tal cual. Cuesta
un mensaje más por DM (1 + hasta 3). La ficha ahora lleva la administración
cuando Wasi la tiene (el mismo colega la preguntó).

Dónde vive: `src/groups/redactar.js#mensajesAlColega` (los mensajes),
`src/groups/envio-colega.js` (el envío, uno para los tres caminos),
`src/groups/vivo.js#quitarYaEnviadas` y `src/data/group-signals.js#refsYaEnviadas`
(no reenviar). Perillas: `RADAR_DM_MAX_PROPIEDADES` (3), `RADAR_DM_PAUSA_MS`
(4000), `RADAR_DM_NO_REENVIAR_DIAS` (7).

## 1. Por qué

Juan: *"los envíos a los clientes sea con la ficha completa y separado uno por
uno y un solo mensaje de followup a las 2 horas del mensaje enviado,
recordatorio al colega, un mensaje por todos los mensajes enviados"*.
"Clientes" = los colegas que reciben los DM del radar. "Ficha completa" = la
ficha de hoy + el link de Wasi (WhatsApp arma la vista previa con la foto; no
se mandan imágenes aparte).

Medido del 31-ago al 10-sep: **19,5 DM/día a 112 colegas, 2,53 propiedades
por DM** (1: 81 · 2: 45 · 3: 26 · 4: 20 · 5: 11 · 6: 23). Hoy salen ~585
mensajes/mes por la línea del radar (no oficial, ya baneada una vez). 44 veces
un colega recibió otro DM a menos de 2 h del anterior. Desde que se abrió el
inbox por lid, 45 de 115 DM tuvieron respuesta (39 %).

## 2. Lo que decidió Juan

1. **Hasta 3 propiedades por pedido, una por mensaje** (opción recomendada;
   descartadas "todas separadas" y "un solo mensaje"). Estimado: ~1.440
   mensajes/mes (2,5 veces lo de hoy).
2. **Un solo recordatorio por colega** a las 2 horas, por todo lo enviado.
3. **No reenviarle una propiedad a un colega que ya la recibió** (caso Sergio
   Neira, 9776631: dijo "Ninguno me sirve" el 9-sep y el 10-sep se la
   volvimos a mandar al republicar el mismo pedido).

## 3. El diseño

### 3.1 Los mensajes
- Mensaje 1: saludo ("te respondo tu PEDIDO N…" / descripción), salvedad de
  no confirmados y la **ficha de la mejor propiedad con su link de Wasi**.
- Mensajes 2 y 3: una ficha cada uno, con su aclaración de desvío si la hay.
- El último cierra con "Comisión compartida — Sofi, asistente virtual" + la
  invitación a Sofi; si había más de 3 aprobadas: "Tengo N opciones más para
  este pedido; si querés verlas, escribile a Sofi (link)".
- 4 segundos entre mensajes.
- Una sola función compartida por los tres caminos del DM (automático,
  aprobar desde Sofi, DM manual del CRM). El borrador para humanos (página del
  aviso, "mandale ESTO YA") sigue siendo un solo mensaje.

### 3.2 Si algo falla
Cada mensaje pasa por el candado de `waha.enviarDm` (solo llamada). Falla el
primero → como hoy (reintento, respaldo, aviso a la asesora). Falla uno del
medio → se corta, se registran solo las refs que salieron y la asesora recibe
aviso con las que faltaron.

### 3.3 No reenviar
Antes de armar el DM se quitan las refs que ese colega (por lid o teléfono)
ya recibió por DM en los últimos 7 días. Si no queda ninguna, no sale DM y el
pedido cae al aviso de la asesora con el motivo "ya se le mandó".

### 3.4 El recordatorio
- Uno por colega, **2 horas después del ÚLTIMO DM** que recibió (si le sale
  otro antes, espera y lo incluye).
- Texto: "Hola {nombre}, ¿te sirvió alguna de las opciones que te pasé?
  PEDIDO 645: Ref A, Ref B · pedido de casa en Envigado: Ref C. Si querés
  coordinar una visita, respondeme por acá." (la línea es el WhatsApp de la
  asesora: la respuesta le llega directo).
- No sale si el colega ya contestó (`linea_dm`), si es solo llamada (candado)
  ni entre 8 p. m. y 8 a. m.; si la hora cae de noche sale a las 8 a. m.,
  salvo que ya hayan pasado más de 20 h (entonces no sale).
- Interruptor `RADAR_RECORDATORIO_COLEGA_ACTIVO`, **apagado** hasta que Juan
  diga.
- Migración: `group_signals.recordatorio_colega_at timestamptz`.

## 4. Riesgo

La cuota de WhatsApp de la línea no cuenta los DM por lid (el 98 %), así que
el freno de volumen no ve la mayor parte de este tráfico. La primera semana
hay que vigilar señales de bloqueo de la línea.

## 5. Siguiente paso

Plan de implementación (`superpowers:writing-plans`) sobre `main` ya
desplegado, rama nueva.
