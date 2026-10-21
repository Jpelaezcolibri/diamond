# Sofi super agente: de la respuesta a la visita

Fecha: 2026-10-21. Estado: aprobado por Juan, que delegó el diseño ("te apruebo los cambios y las mejoras que propones… haz que Sofi sea una super agente inmobiliaria, lo dejo en tus manos"). Base: análisis de ventas del 2026-10-20 y `Claude outputs/diagnostico-por-que-no-vendemos.md`.

## 1. Por qué

En 30 días hubo 1 visita y 0 ventas, aunque el 65 % de los colegas contesta los DM. El embudo se rompe entre el interés y la visita. Las causas concretas:

- **Sofi no ofrece horarios: los pide.** Pregunta "¿qué día y hora te sirve?" (regla 34-B del prompt) y exige 24 h de anticipación también en arriendo.
- **Al cliente o al colega no le llega ningún recordatorio de la visita, ni ningún mensaje después de ella.** `reminders.js` solo le escribe a la asesora.
- **La ficha de Sofi cierra con "Responde SI".** No trae precio por m² en venta ni una pregunta de avance concreta.
- **El seguimiento al colega es genérico.** Dice "¿te sirvió alguna de las opciones?" y no trae nada nuevo.
- **La línea de comisión está fija.** Dice "Comisión compartida." sin el trato, y el 7 % de los colegas que contestan pregunta por ella.
- **Nadie se entera si un cliente queda esperando.** Del 3 al 15 de octubre hubo clientes que esperaron entre 3 y 13 días.

Reglas vigentes que se respetan:
- Seguimiento solo hasta 24 h.
- Tuteo profesional y cercano.
- A la asesora le llegan las visitas. Lo demás va por la campana del CRM, no por WhatsApp.
- Sofi nunca confirma una cita sola.
- Nunca se inventan datos.

## 2. Qué cambia

### 2.1 Horarios ofrecidos, no preguntados

- **Tool nueva `horarios_disponibles`** (`src/agent/tools.js`).
  - Recibe `{ ref?, operacion? }` y devuelve los próximos 3 espacios libres.
  - Usa la misma lógica de `agendar_cita`: `reglas.alternativas` sobre las citas ocupadas de los asesores del ciclo de rotación. Si no hay ciclo, usa el asesor principal.
  - Respeta el horario de cada asesor y la anticipación de la sección 2.2.
  - Formato: lista de ISO más un texto legible en español ("jueves 23 de octubre, 10:00 a. m.").
- **Prompt (cliente y colega).** Cuando la persona muestra intención de visitar o pregunta "¿cuándo se puede ver?":
  1. Sofi llama `horarios_disponibles` y ofrece DOS opciones concretas en un solo mensaje ("¿te sirve el jueves 23 a las 10 a. m. o el viernes 24 a las 3 p. m.?").
  2. Si la persona propone otra hora, se usa esa.
  3. Con la hora elegida llama `agendar_cita`.
  4. Lo demás no cambia: la cita queda SOLICITADA, nunca "confirmada".
  - La regla 34-B ("vos no escoges un espacio") se reemplaza por esta.
  - 34-A sigue igual: una franja no se convierte en una hora que la persona no dijo. Ofrecer horas concretas no es inventar: son espacios libres reales y la persona elige.

### 2.2 Anticipación por operación

- `agenda-reglas` recibe la operación.
  - Venta: `CITAS_ANTICIPACION_MIN_H`, por defecto 24 h (como hoy).
  - Arriendo: `CITAS_ANTICIPACION_ARRIENDO_H`, por defecto **6 h**.
- `agendar_cita` y `horarios_disponibles` sacan la operación de la propiedad (`ref`). Si no hay ref, usan la `categoria` del lead (alquiler → arriendo).
- El corte de 4 h antes y la escalera de rotación no cambian. Una cita de arriendo con 6 h de anticipación tiene 2 h de escalera.

### 2.3 Recordatorio y mensaje después de la visita

Nuevo scheduler `src/scheduler/visita-cliente.js`, cada 10 min, de 8 a. m. a 8 p. m. Trabaja solo sobre citas **confirmadas** (`leads.cita.estado = 'confirmada'`) de tipo visita.

- **Recordatorio, 2 h antes.**
  - Texto: "Hola {nombre}, te recuerdo tu visita de hoy a las {hora} a la Ref {ref} en {zona}. Te recibe {alias}. Si necesitas moverla, respóndeme aquí y la reagendamos."
  - Canal: el de Sofi (Cloud API). Si la ventana de 24 h está cerrada, se usa la plantilla `SOFI_RECORDATORIO_PLANTILLA` (si está configurada). Si no hay plantilla, no sale y se registra.
- **Después de la visita, 3 h después de la hora.**
  - Cliente: "Hola {nombre}, ¿qué te pareció la Ref {ref}? Cuéntame qué te gustó y qué no, y te ayudo con el siguiente paso."
  - Colega: "Hola {nombre}, ¿qué le pareció la Ref {ref} a tu cliente? Si quiere avanzar o ver otras opciones parecidas, aquí estoy."
  - Mismo canal y misma regla de ventana, con `SOFI_POSTVISITA_PLANTILLA`.
- **Una sola vez por cita.** El envío se marca en `leads.cita.recordatorio_cliente_at` y `postvisita_at`.
- **Excepciones:** colega con solo llamada, cita con `origen = 'linea_dm'` (la coordina la asesora por la línea) y cita sin teléfono.
- **Interruptores:** `SOFI_RECORDATORIO_VISITA` y `SOFI_POSTVISITA`, los dos apagados por defecto.
- La respuesta del cliente o del colega entra por el camino normal de Sofi.

### 2.4 La ficha de Sofi vende

- **`buscar_propiedades`** agrega a cada propiedad `precio_m2` (solo venta, calculado en código: `parsearPrecio(precio) / parsearArea(area)`, redondeado a miles; `null` si falta alguno) y `administracion`, si no viene.
- **`FICHA_FORMAT`:**
  - Una primera línea de gancho con el beneficio principal, sacada SOLO de los datos de la ficha ("Dúplex con balcón y 2 parqueaderos en Laureles").
  - En venta, el precio va con "(≈ $X por m²)" cuando haya `precio_m2`.
  - El cierre "¿Te gustaría hablar con un asesor? Responde SI" cambia por una pregunta de avance: "¿Te la muestro esta semana? Te propongo dos horarios." Si la persona dice que sí, se aplica la sección 2.1.
- Las reglas 16, 22 a 25 y 36 no cambian.

### 2.5 Seguimiento al colega con algo nuevo (dentro de 24 h)

- **`seguimiento-colega.js`, toque de +4 h por la línea (solo lid, texto libre).**
  - Antes de mandarlo, se corre el motor otra vez para el pedido (`match.cruzarDemanda` con el pedido reconstruido desde la señal) y la compuerta (`publicable.filtrar`, con aclaración si `RADAR_DM_CON_ACLARACION`).
  - Se quitan las refs de `respuesta_refs` y las que se le mandaron en 7 días.
  - Si queda alguna, el texto agrega UNA ficha corta: "Además encontré esta otra que se ajusta a tu pedido:" + título, ref, zona, precio y link de Wasi (+ aclaración si aplica). La señal guarda la ref en `respuesta_refs`.
  - Si no queda ninguna, el texto sigue como hoy.
- **El toque de +24 h** por plantilla no cambia. Es el último: la regla de 24 h se cumple.
- **Interruptor:** `RADAR_SEGUIMIENTO_CON_OPCION`, apagado por defecto.

### 2.6 Línea de comisión configurable

- **`RADAR_LINEA_COMISION`** reemplaza "Comisión compartida." en el primer mensaje del DM al colega (los tres sitios de `redactar.js`) y "Comparto comisión con colegas 🤝" en el post de grupo.
  - Ejemplo: "Comisión 50/50 con el colega que traiga el cliente."
  - Por defecto, el texto de hoy.
  - El valor lo define la directiva (documento de captación, sección 9).
- **El prompt de Sofi con colegas:** si `RADAR_LINEA_COMISION` está definida, Sofi puede repetir ESE texto cuando le pregunten por la comisión. Si no está, sigue como hoy: "los términos los acuerdan con la asesora".

### 2.7 Nadie espera sin que alguien se entere

Nuevo scheduler `src/scheduler/lead-esperando.js`, cada 5 min, de 8 a. m. a 8 p. m. Busca conversaciones cuyo último mensaje es del usuario, con más de **15 min** y sin respuesta posterior.

- **Conversación en modo bot (Sofi debía contestar y no lo hizo):** alerta técnica a Juan (`enviarAlertaTecnica`): "Sofi no ha contestado a N clientes en 15 min".
  - Una por episodio: no se repite hasta que Sofi vuelva a contestar.
  - Esto habría detectado el silencio del 3 al 15 de octubre el primer día.
- **Conversación en modo humano:** notificación por la campana del CRM a la asesora dueña del lead (`notificar`, tipo `cliente_esperando`), una vez por mensaje. Nunca por WhatsApp.
- La marca se guarda en `leads.seguimiento.espera_alertada_msg_id`.
- **Interruptor:** `SOFI_ALERTA_ESPERA`, encendido por defecto (avisos internos, no a terceros).

## 3. Lo que NO entra

- Que Sofi conteste en la línea personal de Daiana (riesgo de baneo).
- Plantillas nuevas de Meta. Las secciones 2.3 funcionan dentro de la ventana y quedan listas para cuando existan `recordatorio_visita` y `postvisita`.
- Video y fotos adicionales. Es trabajo de campo de las asesoras.
- Embudo de oportunidades (spec aparte).

## 4. Pruebas

- Unitarias:
  - Anticipación por operación.
  - `horarios_disponibles`: espacios reales, ocupación por asesor, horario y anticipación.
  - `precio_m2`.
  - Scheduler de visita: tiempos, ventana, plantilla, una sola vez y excepciones.
  - Seguimiento con opción nueva: excluye lo enviado y usa la aclaración.
  - Línea de comisión.
  - Lead esperando: modo bot y modo humano, un aviso por episodio u horario.
- Prompt: correr `scripts/replay-sofi.js` sobre conversaciones reales con intención de visita y revisar que Sofi ofrezca dos horarios, no confirme y no invente.
- Tuteo: el test de voseo cubre los textos nuevos.
