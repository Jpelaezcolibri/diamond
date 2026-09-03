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

## Opción D — Un link en el aviso: abrirlo es el dato, y adentro se trabaja

Propuesta de Juan (2026-09-02, tarde). Cada aviso a la asesora lleva un link
con un token único. Abrirlo registra `visto_at`; adentro está la mesa de
trabajo de ese pedido: las fichas, el contacto del colega, el texto del DM
listo para copiar, y dos toques — "ya le escribí" / "no sirve" — que
registran `gestionado`. Sin login, sin entrar al CRM, una pantalla por pedido.

**Por qué es mejor que A y B.** A da el dato pero no sirve para trabajar; B
sirve para trabajar pero no se abre. D hace las dos cosas desde el mismo
mensaje. Y reemplaza el KPI "por revisar" —que hoy mide clics en el CRM que
nadie hace— por dos medidas reales: **vistos** y **gestionados**.

**La regla que lo hace seguro.** No se guarda toda la información detrás del
link. El aviso sigue diciendo inline lo esencial (quién, qué busca, contacto);
detrás van las fichas, las observaciones y el DM. Si un día no le abre, no
pierde el negocio por una métrica.

**Cómo se arma, reutilizando:**
- Token por aviso, irrepetible, con vencimiento; resuelve la organización
  solo (multi-tenant). Columna `aviso_token` en `group_signals`.
- Ruta nueva en el CRM, para celular: `/aviso/[token]`. Muestra lo que ya
  existe (tarjeta de señal, fichas, link de Wasi, texto del DM) y acciona lo
  que ya existe (`responderPorDmManual`, `rechazarPedidoRadar`).
- Primer GET graba `visto_at`; la acción graba `gestionado_at` + `gestion`.
- El aviso sale con un botón de URL de WhatsApp ("Ver la oportunidad") —
  la Cloud API lo soporta (`cta_url`) — y el mismo link va al respaldo.
- El DM automático al colega no cambia: esto es solo para lo que va a la
  asesora.

Esfuerzo: dos o tres días (página, token, dos KPIs, botón de URL).

### El contador: si no lo abre a tiempo, pasa a Catherine

Propuesta de Juan sobre D. Revisión crítica, no complaciente:

**Lo que tiene de bueno.** Hoy ya existe un escalado a Catherine
(`scheduler/radar-silencio.js`) que dispara cuando Natalia "no respondió el
aviso" — o sea, cuando no le escribió nada a Sofi. Es una señal débil: puede
haber llamado al colega sin contestarle a Sofi. "Abrió el link" es mejor señal,
y "gestionó" es la mejor. El contador no es un mecanismo nuevo: es cambiarle
el disparador a uno que ya existe. Eso es un punto a favor, no en contra.

**Donde falla si se hace literal:**

1. *Abrir no es actuar.* Si el contador se apaga con "lo abrió", una mirada
   de dos segundos silencia el escalado y el pedido muere callado. El
   contador tiene que contar hasta **gestionado**, no hasta visto. "Visto"
   solo cambia el texto del escalado ("lo abrió hace 40 min y no hizo nada").
2. *Copia no, traspaso sí.* Si las dos lo reciben, las dos pueden escribirle
   al mismo colega por la misma propiedad — el desorden que las reglas de
   comisión compartida existen para evitar, y se ve mal ante el colega. Cuando
   pasa a Catherine, el link de Natalia dice "pasó a Catherine" y el de
   Catherine dice "era de Natalia". Una dueña a la vez. `entrega-asesor.js`
   ya escribe ese encabezado.
3. *El reloj tiene que saber la hora.* Treinta minutos a ciegas a las 7 pm, en
   visita o un domingo, y Catherine recibe copias de cosas que Natalia habría
   resuelto a las 8 am. El contador cuenta solo en horario (`advisors.horario`
   ya existe: Catherine 08:00-18:00) y se pausa afuera.
4. *Solo lo aprobado.* El escalado es para oportunidades con `refs_utiles`.
   Escalar dudosas es recrear en la línea de Catherine los 22 avisos por día
   que se acaban de quitar de la de Natalia.
5. *Capacidad.* Hoy fueron 22 avisos a Natalia. Si abre la mitad, son ~11
   escalados por día a Catherine. Si ella no los va a trabajar, el escalado es
   teatro. Es la pregunta #5-#7 de mañana, no un parámetro del código.

**Lo que no arregla, y hay que decirlo:** si Natalia no abre los links, la
solución no es Catherine — es la conversación de mañana.

**Recomendación:** hacerlo, con estas cinco condiciones, reemplazando el
disparador de `radar-silencio.js` (no un scheduler nuevo). Ventana inicial
generosa (2 h en horario) y medir dos semanas antes de apretarla.

## Recomendación

**D, si Natalia dice que abriría un link en el aviso.** Si no, A ahora y C
después. En cualquiera de los dos casos, el contador entra con las cinco
condiciones de arriba.

Lo que decía antes de la opción D — **A ahora. C cuando el botón ya se esté usando.** Empezar por lo que se va a
usar de verdad y medir la tasa de respuesta de Natalia a los botones antes de
construir la pantalla. Si en dos semanas el botón se toca en más del 60% de
los avisos, vale la pena B encima. Si no, el problema no es la herramienta.

## También para mañana: Natalia como punto único de falla (hallazgo #3)

72 de 133 mensajes del 2 de septiembre fueron para ella. Es la única línea
vinculada, la única que recibe avisos y la única que aprueba. Cuando su
ventana se cerró el 25 de agosto, 45 mensajes se aceptaron y no llegaron a
nadie. El respaldo a Catherine existe desde hoy, pero solo salta por ventana
cerrada — no por "Natalia lleva cuatro horas en una visita".

Preguntas para ella:

5. ¿Cuántos avisos por día podés atender de verdad sin que se te vuelvan ruido?
6. Si estás en visita, ¿preferís que se acumulen y te lleguen agrupados
   después, o que los reciba Catherine mientras tanto?
7. ¿Hay pedidos que preferís que vayan directo a otra persona (por zona, por
   tipo, por monto)?

## DECISIÓN (Juan, 2026-09-02, noche): opción D. Abrir el link es política de la empresa.

Natalia la adopta. Lo que sigue es el diseño del flujo completo, partido en
bloques para mirarlo uno por uno. Incluye dos verdades técnicas que hay que
aceptar antes de construir.

### Verdad técnica 1: no existe un link que abra un GRUPO con el mensaje puesto

Lo que Juan pidió: "al darle enviar se abra WhatsApp y se vincule con el
grupo al cual se le debe enviar el mensaje". WhatsApp no ofrece eso:

| Link | Qué hace | Sirve para |
|---|---|---|
| `wa.me/<numero>?text=...` | Abre el chat directo con ESA persona, con el texto ya escrito | Colegas con número resuelto |
| `whatsapp://send?text=...` | Abre WhatsApp con el texto y el SELECTOR de chats; ella elige a quién | Cualquier caso; un toque más, y no sabemos a quién eligió |
| `chat.whatsapp.com/<invite>` | Abre la pantalla de UNIRSE al grupo, no el chat | Nada |
| Abrir un grupo por su id con texto | No existe | — |

Además la regla de hoy (Juan, misma fecha) es que la respuesta va al PRIVADO
del colega, nunca al grupo. Así que el destino correcto es el chat directo, y
ahí está el nudo: **los pedidos que le llegan a Natalia son justamente los
que no tienen número** — los que sí lo tienen ya los mandó el bot solo. Un
link que depende del número no ayuda en el caso que más importa.

Lo que SÍ se puede hacer, por caso:

- **Con número** (el bot no mandó por límite diario, pedido vencido o rechazo
  de WhatsApp): botón "Enviar" → `wa.me/<numero>?text=<mensaje>` → se abre el
  chat con el texto listo → ella toca enviar en WhatsApp. Dos toques.
- **Sin número** (la mayoría): botón "Copiar mensaje y abrir WhatsApp" →
  copia el texto al portapapeles y abre WhatsApp → la página le dice en qué
  grupo está el colega y que toque su nombre → pega y envía. Cuatro toques,
  todos en su teléfono, que es donde están los grupos.

En los dos casos, **el toque del botón en la página es nuestra medición**
(`gestionado_at`, con `gestion = "envio"`). No podemos ver el envío real
dentro de WhatsApp; vemos la intención, que es lo más cerca que se puede
llegar sin volver a publicar por la línea vinculada.

### Verdad técnica 2: Catherine no está en los grupos

Hallazgo de Juan: los grupos viven en el teléfono de Natalia. Si un pedido se
escala a Catherine, ella no puede tocar el nombre del colega porque no ve el
grupo; tendría que devolvérselo a Natalia. El escalado como estaba pensado no
cierra.

Tres salidas, de mejor a peor:

1. **Catherine entra a los mismos grupos con su propio celular.** Sin WAHA,
   sin vincular nada: solo membresía. Con eso puede tocar nombres y escribir
   por privado igual que Natalia. Es una decisión de negocio (¿la aceptan en
   los grupos?), no de código. Si se puede, el escalado es un traspaso real.
2. **El escalado solo para casos con número.** Catherine recibe `wa.me` y
   puede escribir desde su teléfono. Cubre pocos casos (ver arriba).
3. **El escalado es un recordatorio, no un traspaso.** Catherine recibe
   "Natalia tiene esto sin gestionar hace 2 h" y la empuja. Barato, débil.

### Los bloques

**Bloque 1 — El link y la medición.** Token por aviso, página `/aviso/[token]`
para celular, botón de URL "Ver la oportunidad" en el aviso de WhatsApp,
`visto_at` al abrir. KPIs: "por revisar" desaparece; entran **vistos** y
**gestionados**. Vale solo, sin los otros bloques. ~2 días.

**Bloque 2 — El envío asistido.** En la página: el mensaje ya redactado
(`redactar.mensajeGrupo`, el mismo del DM automático, con las observaciones
de lo no confirmado), y el botón según el caso: `wa.me` si hay número,
"Copiar y abrir WhatsApp" si no. Más "No sirve". El toque graba
`gestionado_at`. ~1 día.

**Bloque 3 — El contador y el traspaso.** Solo después de decidir qué pasa
con Catherine (salida 1, 2 o 3). Reemplaza el disparador de
`radar-silencio.js` por "sin gestionar", solo en horario, solo aprobadas,
ventana inicial 2 h. El link de la que lo pierde dice "pasó a X". ~1 día
una vez decidido.

**Orden:** 1 → 2 → decidir Catherine → 3. Cada bloque se mira antes del
siguiente.

## Preguntas para Natalia (mañana)

0. Si el aviso trajera un link "Ver la oportunidad" con las fichas y el
   contacto, ¿lo abrirías? ¿Desde ahí marcarías "ya le escribí"?
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
