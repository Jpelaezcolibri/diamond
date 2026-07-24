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

module.exports = { getClient, _setClientForTests };
