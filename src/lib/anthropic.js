// Cliente Anthropic compartido. Antes cada modulo (engine.js, followups.js,
// sofi-comando.js) instanciaba el suyo; engine.js lo hacia SIN timeout (el
// SDK por defecto espera hasta 10 min), lo que dejaba a un cliente de
// WhatsApp sin respuesta si la API se colgaba. Centralizar aqui uniforma el
// timeout y ademas habilita inyectar un mock en tests (_setClientForTests) —
// engine.js instanciaba el cliente a nivel de modulo, lo que lo hacia
// imposible de testear sin llamar a la API real.
const Anthropic = require("@anthropic-ai/sdk");
const config = require("../config");

const DEFAULT_TIMEOUT_MS = 60 * 1000;

let client = null;
let testClient = null;

function getClient() {
  if (testClient) return testClient;
  if (!client) client = new Anthropic({ apiKey: config.anthropicApiKey, timeout: DEFAULT_TIMEOUT_MS });
  return client;
}

// Solo para tests: inyecta un cliente mock (objeto con messages.create).
// Llamar con null/undefined para volver al cliente real.
function _setClientForTests(mock) {
  testClient = mock || null;
}

// Marcador de prompt caching para los bloques ESTABLES (persona, reglas,
// geografia, definiciones de herramientas).
//
// Por que 1 hora y no los 5 minutos por defecto: el bloque estable es
// IDENTICO para todos los leads de la misma org y rol — son ~10.000 tokens
// (4.934 de TOOL_DEFINITIONS + ~5.300 del prompt) que no dependen de con
// quien se este hablando. Con TTL de 5 minutos ese prefijo se re-escribia
// constantemente porque una conversacion de WhatsApp no va a ese ritmo: el
// cliente contesta a los 3 minutos y pega, contesta a los 20 y se paga
// entero. Con 1 hora, una sola escritura cubre TODOS los mensajes de esa
// hora, de todos los leads.
//
// La escritura cuesta 2x en vez de 1,25x y la lectura sigue siendo 0,1x, asi
// que se amortiza con el segundo mensaje de la hora. Medido sobre el volumen
// real de 30 dias (466 llamadas de engine + 218 del Centro de Comando), la
// diferencia es de ~17,7 a ~8,3 USD/mes.
//
// ANTHROPIC_CACHE_TTL permite volver a "5m" sin desplegar. Cualquier otro
// valor lo rechaza la API con un 400, asi que se valida aca: un typo en una
// variable de entorno no puede dejar al bot sin responder.
const TTL_VALIDOS = new Set(["5m", "1h"]);
const TTL = TTL_VALIDOS.has(process.env.ANTHROPIC_CACHE_TTL) ? process.env.ANTHROPIC_CACHE_TTL : "1h";
if (process.env.ANTHROPIC_CACHE_TTL && !TTL_VALIDOS.has(process.env.ANTHROPIC_CACHE_TTL)) {
  console.warn(
    `[anthropic] ANTHROPIC_CACHE_TTL="${process.env.ANTHROPIC_CACHE_TTL}" no es valido (solo 5m o 1h) — se usa ${TTL}`
  );
}

const CACHE_ESTABLE = Object.freeze({ type: "ephemeral", ttl: TTL });

// Deja en el log cuanto del prompt se leyo del cache y cuanto se pago entero.
//
// Existe porque el prompt caching es el unico ahorro del sistema que falla en
// SILENCIO: si el marcador se cae, si el bloque estable deja de ser estable, o
// si el TTL vuelve a 5 minutos, no se rompe nada — solo se paga de mas, y no
// hay forma de enterarse sin abrir la consola de Anthropic. Con esto alcanza
// con mirar los logs de Railway.
//
// `cache_read` alto y `escrito` bajo = el cache esta pegando. `escrito` alto
// en cada llamada = el prefijo se esta invalidando y hay que mirar que se
// colo dentro del bloque estable.
//
// Best-effort y sin PII: solo cuenta tokens, nunca contenido. Un `usage`
// ausente o raro no puede tumbar una respuesta al cliente.
function registrarUso(ruta, usage) {
  try {
    if (!usage) return;
    const leido = usage.cache_read_input_tokens || 0;
    const escrito = usage.cache_creation_input_tokens || 0;
    const fresco = usage.input_tokens || 0;
    const entrada = leido + escrito + fresco;
    if (!entrada) return;
    const pct = Math.round((leido / entrada) * 100);
    console.log(
      `[uso] ${ruta} entrada=${entrada} cache_read=${leido} (${pct}%) escrito=${escrito} fresco=${fresco} salida=${usage.output_tokens || 0}`
    );
  } catch {
    // Medir nunca puede romper lo medido.
  }
}


module.exports = { getClient, _setClientForTests, CACHE_ESTABLE, registrarUso };

