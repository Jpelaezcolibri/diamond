# Radar: qué pasa después del aviso — opciones para decidir con Natalia

**Estado:** decisión pendiente. Juan la revisa con Natalia el 2026-09-03.
**Origen:** revisión del sistema del 2026-09-02. Hallazgo #2: "el radar no sabe
qué pasa después del aviso".

## El problema

El radar le mandó 22 oportunidades a Natalia el 2 de septiembre. No hay forma
de saber cuántas trabajó. El sistema registra cuándo el *bot* responde
(`respondida_at`, `respuesta_refs`), pero no cuándo la *asesora* le escribe al
colega, ni si el colega contestó, ni si hubo visita. El embudo está ciego desde
el aviso en adelante.

Mientras eso no se mida, no se puede saber si los avisos valen algo o son ruido
bien redactado. Y tampoco se puede saber qué tipo de pedido termina en negocio,
que es lo que después calibra el puntaje.

## Lo que ya existe y se reutiliza

- El aviso a la asesora sale por la Cloud API oficial con `aviso_wamid`
  guardado en la señal (`group_signals.aviso_wamid`, `aviso_advisor_id`).
- Ya hay botones interactivos en el aviso: `radar_no:<signalId>` ("No sirve"),
  manejado en `src/channels/whatsapp.js` → `vivo.rechazarPedidoRadar`.
- Una respuesta citada (swipe-to-reply) se resuelve a la señal exacta por
  `groupSignals.findByWamid`.
- `aviso_refs` (nuevo, 2026-09-02) dice qué propiedades llevaba cada aviso.

Es decir: el canal de vuelta desde WhatsApp hasta la señal **ya está abierto**.
Lo que falta es qué se le pregunta a Natalia y dónde se guarda.

## Opción A — Desde el mismo WhatsApp, respondiendo al aviso

Al aviso se le suman botones (WhatsApp permite máximo 3 por mensaje):

- **Ya le escribí** → `contactado_at`
- **No sirve** (ya existe) → `descartado`
- **Cerrado / visita** → `resultado`

Natalia no sale del chat donde ya está. Cero fricción, por eso es lo que más se
va a usar. Una respuesta libre citando el aviso ("le escribí, quedó de
pensarlo") también se puede capturar como nota, sin interpretarla: se guarda
el texto tal cual.

**A favor:** se usa de verdad. Reusa todo lo que ya existe. Una migración
(3 columnas en `group_signals`) y un manejador de botón nuevo.
**En contra:** cabe poco. No hay fecha de visita, ni monto, ni nombre del
cliente del colega. Es un dato mínimo, no un CRM.

## Opción B — Desde el CRM, en la lista de señales

Cada aviso en `/grupos` tiene un estado que Natalia cambia: *sin contactar →
contacté → en conversación → visita agendada → cerrado / descartado*, con nota
libre y fecha.

**A favor:** dato rico. Permite reportar por asesora, por zona, por tipo de
pedido. Es lo que después alimenta la calibración del puntaje.
**En contra:** Natalia hoy no vive en el CRM, vive en el teléfono. Si tiene que
abrir otra pantalla para marcar algo, lo marca la mitad de las veces. Un dato
capturado a medias es peor que ninguno: da la sensación de medir sin medir.

## Opción C — Las dos, con WhatsApp como principal

El botón registra lo mínimo en el momento; el CRM permite completar después
(nota, fecha, resultado) para lo que valga la pena. Es A primero y B encima
cuando el dato mínimo ya esté fluyendo.

## Recomendación

**A ahora. C cuando el botón ya se esté usando.** Empezar por lo que se va a
usar de verdad y medir la tasa de respuesta de Natalia a los botones antes de
construir la pantalla. Si en dos semanas el botón se toca en más del 60% de
los avisos, vale la pena B encima. Si no, el problema no es la herramienta.

## Preguntas para Natalia (mañana)

1. Cuando te llega un aviso y le escribís al colega, ¿te costaría tocar un
   botón en el mismo mensaje para dejarlo registrado?
2. ¿Qué es lo mínimo que te serviría recordar después de cada aviso: solo
   "ya le escribí", o también en qué quedó?
3. ¿Abrís el CRM en el día, o solo el teléfono?
4. De los 22 avisos de hoy, ¿a cuántos les escribiste? (calibra la base)

## Fuera de alcance (por ahora)

- Leer las respuestas del colega en la línea vinculada de Natalia (WAHA) para
  detectar solo si contestó. Es posible, pero toca la línea de ella y el
  riesgo de baneo pesa más que el dato.
- Cerrar el círculo con Wasi (marcar la propiedad como "en negociación").
