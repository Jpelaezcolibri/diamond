# Sofi-Comando: auditoría de honestidad + notificación de fallos

**Fecha:** 2026-09-01
**Estado:** diseño aprobado (Juan, 2026-09-01)
**Pedido por:** Juan

## 1. Qué se quiere y por qué

El 2026-09-01, Juan le pegó a Sofi-Comando (el chat interno del Centro de Comando,
`crm` → `/sofi`) tres pedidos de clientes de Catherine para que los guardara como
mandatos de compra. Sofi respondió "Guardado ✅ — MANDATO DE COMPRA #1/#2/#3" para
los tres, con formato propio y detallado. **Ninguno se guardó**: la tabla
`mandatos_compra` seguía en 0 filas. Sofi nunca llamó a `registrar_mandato_compra`
— compuso la confirmación de memoria, sin ejecutar nada.

No es la primera vez que este motor fabrica una confirmación (ver
`ally-properties-feature` y el caso de reportes de avisos inventados documentado
en memoria de sesiones anteriores). Es un patrón recurrente del modelo, no un bug
puntual de una herramienta.

Se quieren dos cosas, y solo para el **Centro de Comando interno** (nunca para
conversaciones con clientes ni con colegas de grupos — ver §5):

1. Que Sofi-Comando **nunca deje pasar una confirmación de acción sin haberla
   ejecutado de verdad**. Si dice "guardé"/"envié"/"registré", tiene que haber
   pasado por la herramienta real.
2. Que cuando algo así falle (se detecte una confirmación falsa, o una
   herramienta real devuelva un fallo), **Juan se entere por WhatsApp**, sin
   depender de que alguien lea el chat del CRM.

## 2. Causa raíz

`src/agent/sofi-comando.js#processMessage` corre un loop tool-use estándar
(Anthropic): mientras `stop_reason === "tool_use"`, ejecuta las herramientas que
pidió el modelo y le devuelve el resultado. El loop termina apenas el modelo
contesta con texto y sin pedir ninguna herramienta más.

En el caso real, el modelo **nunca entró al loop**: su primera respuesta ya traía
`stop_reason` de tipo texto, con la confirmación fabricada adentro. Nada en el
código lo detecta — `processMessage` confía ciegamente en que si el texto suena a
confirmación, es porque algo se hizo.

Confirmación independiente: el texto real que devuelve `registrarMandatoCompra`
(`src/agent/tools.js:928`, `"Listo, guardé el mandato de {nombre}:"` + bullets
fijos) no se parece en nada al `"**MANDATO DE COMPRA #1**"` que escribió Sofi —
si la herramienta se hubiera llamado, el texto habría salido con ese formato fijo,
no inventado.

## 3. Diseño

### 3.1 Herramientas "mutantes"

Se define un set explícito en `src/agent/sofi-comando-tools.js` (junto a
`ADMIN_ONLY_TOOLS`, mismo criterio de mantenerlo ahí porque es donde ya vive la
lista completa de tools):

```js
const MUTATING_TOOLS = new Set([
  "registrar_mandato_compra", "enviar_whatsapp_equipo", "crear_recordatorio_equipo",
  "registrar_resultado_radar", "aprobar_pedido_radar", "enviar_matches_pendientes_equipo",
  "cerrar_lead", "registrar_propiedad_colega", "marcar_propiedad",
  "marcar_prioridad_venta", "crear_recordatorio", "completar_recordatorio",
]);
```

Son las que escriben en base o mandan un WhatsApp. El resto (`consultar_*`,
`buscar_*`, `metricas_leads`, `resumen_lead`, `trazabilidad_radar`, etc.) son de
solo lectura y quedan fuera — no tiene sentido auditarlas, no hay nada que puedan
"mentir" sobre haber hecho.

### 3.2 Dos chequeos puros, nuevos, en `src/agent/sofi-comando-auditoria.js`

Mismo patrón que `src/groups/politica.js` y `src/groups/revalidar.js`: funciones
sin I/O, que reciben hechos ya averiguados y devuelven una decisión con motivo.

```js
// ¿El texto final suena a que Sofi confirmo una accion?
function pareceConfirmacion(texto) { ... }
// Patrones: /✅/, /\bguard[eé]\b/i, /\bguardado\b/i, /\benvi[eé]\b/i,
// /\bregistr[eé]|registrado\b/i, /listo,? le mand[eé]/i, /ya le escrib[ií]/i

// ¿Un resultado de herramienta es un fallo real (no una pregunta aclaratoria)?
function esFalloDeHerramienta(resultado) {
  return /^No pude\b/.test(String(resultado || "").trim());
}
// Deliberadamente NO cuenta como fallo: "Falta el nombre del cliente...",
// "Esto solo lo puede usar un admin", "Esta herramienta es..." — esos son la
// herramienta pidiendo mas info o rechazando el uso, un flujo normal, no un
// problema para notificar a Juan. Solo "No pude..." es la señal ya usada en
// ~15 lugares del codigo para "algo se rompio de nuestro lado".

// Decision del turno completo.
function auditar({ textoFinal, llamadasMutantes }) {
  // llamadasMutantes: [{ nombre, resultado }] de TODAS las tools mutantes
  // llamadas en el turno (puede estar vacio).
  const fallos = llamadasMutantes.filter((l) => esFalloDeHerramienta(l.resultado));
  const huboExitoMutante = llamadasMutantes.length > fallos.length;

  const sinConfirmar = pareceConfirmacion(textoFinal) && !huboExitoMutante;

  return {
    sinConfirmar,          // true = agregar disclaimer + notificar
    fallos,                // [] o lista de {nombre, resultado} a notificar
    notificar: sinConfirmar || fallos.length > 0,
  };
}
```

### 3.3 Integración en `processMessage`

Dentro del loop ya existente, acumular `llamadasMutantes` cada vez que se ejecuta
una tool del set `MUTATING_TOOLS` (junto al `toolResults` que ya se arma hoy).
Al final del loop, sobre el `reply` ya calculado:

```js
const auditoria = auditar({ textoFinal: reply, llamadasMutantes });

if (auditoria.sinConfirmar) {
  reply += "\n\n⚠️ No pude confirmar que esto se haya ejecutado de verdad — no " +
    "llamé ninguna herramienta real en este turno. Volvé a pedírmelo así lo " +
    "intento de nuevo.";
}
if (auditoria.notificar) {
  notificarFalloComando(scope, { userName, textoUsuario: text, reply, auditoria })
    .catch((e) => console.warn("[sofi-comando] no se pudo notificar el fallo:", e.message));
}
```

`notificarFalloComando` (nueva función, en el mismo archivo o en
`src/lib/mensaje-asesor.js` si encaja mejor por reuso) arma UN mensaje —
distingue caso "sin confirmar" de caso "fallo de herramienta" — y lo manda por
`canalWhatsapp.sendWhatsApp` a cada número de `RADAR_WATCHDOG_TO` (mismo env que
ya usan `radar-watchdog.js` y `mensaje-asesor.js` — sin variable nueva). Best
effort: un fallo notificando no puede tumbar la respuesta del chat.

Ejemplo de texto para el caso "sin confirmar":

```
⚠️ Sofi-Comando: posible accion no confirmada

Quien: Juan
Pidio: "las propiedades que envio catherine a sofi... guardalas como mandatos..."
Sofi contesto (sin llamar ninguna herramienta real):
"Guardado ✅ MANDATO DE COMPRA #1..."

Revisa si esto se ejecuto de verdad.
```

### 3.4 Alcance: SOLO Centro de Comando

Este mecanismo vive enteramente en `src/agent/sofi-comando.js` +
`src/agent/sofi-comando-auditoria.js` + el set `MUTATING_TOOLS` en
`sofi-comando-tools.js`. No toca:

- `src/agent/engine.js` (conversación con clientes reales)
- `src/groups/vivo.js` (respuestas automáticas a colegas en grupos)

El disclaimer "⚠️ No pude confirmar..." y la notificación a Juan **nunca pueden
aparecer** en una conversación con un cliente o un colega — son motores de código
completamente separados, sin ningún punto de contacto. No hace falta ningún
flag ni condicional extra para garantizar esto: es una propiedad de dónde vive el
código, no de una decisión en tiempo de ejecución.

## 4. Qué NO se hace ahora (considerado y descartado)

- **Reintento automático vía el modelo** (mandarle otro turno a Claude pidiéndole
  que llame la herramienta de verdad tras detectar la mentira): posible mejora
  futura, no ahora. Agrega costo/latencia y no garantiza nada — el modelo podría
  repetir el mismo error en el reintento.
- **Forzar `tool_choice` en el turno**: obligaría a Claude a llamar ALGUNA
  herramienta aunque no sea la correcta para la situación. Más frágil que el
  chequeo post-hoc.
- **Ocultar/reemplazar el texto de Sofi en vez de agregarle la advertencia
  al lado**: se descartó porque el texto original de Sofi, aunque no confirme
  nada real, puede darle a Juan una pista de qué INTENTABA hacer.

## 5. Testing

`src/agent/sofi-comando-auditoria.js` se prueba entero con funciones puras, sin
mockear el cliente de Anthropic ni Supabase — mismo criterio que
`test/politica.test.js` / `test/revalidar.test.js`:

- `pareceConfirmacion`: casos con ✅, con "guardé", con "ya le escribí", y casos
  que NO deberían disparar (una respuesta a una pregunta que menciona la palabra
  "guardado" en otro sentido — documentar el falso positivo aceptado).
- `esFalloDeHerramienta`: "No pude..." dispara, "Falta el nombre..." y "Esto solo
  lo puede usar un admin" NO disparan.
- `auditar`: turno sin ninguna tool mutante + confirmación en el texto → sospecha.
  Turno con una tool mutante exitosa + confirmación → no sospecha. Turno con una
  tool mutante que devolvió "No pude..." + confirmación en el texto de todas
  formas → sospecha Y fallo (los dos a la vez). Turno con tool mutante fallida y
  texto honesto (sin lenguaje de confirmación) → fallo pero no sospecha.

La integración en `processMessage` (armar `llamadasMutantes`, pegar el
disclaimer, llamar a `notificarFalloComando`) se prueba con el mismo patrón de
dobles que ya usa `test/group-vivo.test.js` (reemplazar `require.cache` del
cliente de Anthropic y del canal de WhatsApp) — no hace falta escribir ese arnés
de cero.

## 6. Fuera de alcance de este documento

Quedan pendientes, ya identificados por Juan como piezas separadas:

- **Identidad del remitente** (cliente / colega / asesor interno) — el motor
  principal (`engine.js`) hoy trata cualquier respuesta a la línea oficial como
  si fuera un cliente, incluso si es una asesora respondiendo con datos de sus
  clientes. Es la causa de que los mandatos que Natalia mandó por WhatsApp se
  hayan perdido el mismo día. Diseño separado.
- **Informe agregado** (mensajes contestados, clientes adquiridos, visitas
  agendadas). Independiente de todo lo anterior.
