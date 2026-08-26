const { test } = require("node:test");
const assert = require("node:assert");

// Fuerza el store en memoria ANTES de cargar el modulo: este test no debe
// tocar la Supabase real aunque el .env este configurado (config usa dotenv
// con override, asi que limpiar process.env no alcanza — se anula el cliente
// directamente en require.cache).
const supabasePath = require.resolve("../src/data/supabase");
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: null };
const conversations = require("../src/data/conversations");

// Regresion critica: un mensaje 'system' ("Transferido a...") dentro del
// historial romperia la llamada a la API de Anthropic, que solo acepta
// user/assistant en `messages`.
test("getRecentMessages excluye las notas 'system' del historial de Claude", async () => {
  const conv = await conversations.findOrCreate("org-test", "lead-test", null);
  await conversations.appendMessage(conv.id, "user", "Hola");
  await conversations.appendMessage(conv.id, "assistant", "Hola! Soy Sofi");
  await conversations.appendMessage(conv.id, "system", "Transferido a Asesor de Ventas — 23/07/2026, 10:15 a. m.");
  await conversations.appendMessage(conv.id, "user", "Gracias");

  const history = await conversations.getRecentMessages(conv.id, 12);
  assert.equal(history.length, 3);
  assert.ok(history.every((m) => m.role === "user" || m.role === "assistant"));
  assert.ok(!history.some((m) => /Transferido a/.test(m.content)));
});

// Regresion (Juan, review sobre c41d1b4): radar-silencio.js necesita saber si
// HAY algun mensaje entrante despues de una fecha, no solo cual es el ULTIMO
// mensaje de la conversacion -- si el ultimo mensaje que se guardo es viejo
// pero hay OTRO mas viejo todavia despues de la fecha (mensajes desordenados),
// antes no se detectaba.
test("hayMensajeEntranteDespues: true si algun mensaje 'user' quedo despues de la fecha, sin importar el orden de insercion", async () => {
  const conv = await conversations.findOrCreate("org-test", "lead-desorden", null);
  const antes = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const viejo = await conversations.appendMessage(conv.id, "user", "mensaje viejo");
  viejo.created_at = new Date(Date.now() - 90 * 60 * 1000).getTime();
  const nuevoPeroInsertadoAntes = await conversations.appendMessage(conv.id, "user", "mensaje mas viejo todavia, pero insertado despues");
  nuevoPeroInsertadoAntes.created_at = new Date(Date.now() - 120 * 60 * 1000).getTime();

  assert.strictEqual(await conversations.hayMensajeEntranteDespues(conv.id, antes), false);

  const posterior = await conversations.appendMessage(conv.id, "user", "este si es posterior");
  posterior.created_at = Date.now();

  assert.strictEqual(await conversations.hayMensajeEntranteDespues(conv.id, antes), true);
});
