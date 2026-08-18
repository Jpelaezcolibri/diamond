// Bug real encontrado en produccion el 2026-08-18: kt@diamond.com abrio el
// Centro de Comando y vio "SOFI está preparando tu día…" indefinidamente.
//
// Causa raiz (confirmada consultando Supabase directo): `command_sessions` no
// se cierra sola — "Cerrar el dia" es un boton manual — y openSession()
// decidia si ya existia el briefing de HOY preguntando solo "¿esta sesion
// tiene algun mensaje?". Con una sesion abierta desde julio cuyo ultimo
// mensaje era del 14 de agosto, la respuesta era "si" y nunca se generaba un
// briefing nuevo. Como el chat del CRM solo muestra hoy+ayer
// (getUserCommandMessages), el resultado era una pantalla vacia para siempre.

const { test } = require("node:test");
const assert = require("node:assert");
const command = require("../src/data/command");
const sofiComando = require("../src/agent/sofi-comando");

const SCOPE = { orgId: "org-1", viewerUid: "user-1", isAdmin: false };

function mockConsultasBriefing(t) {
  t.mock.method(command, "metricasLeads", async () => ({ nuevos: 0, por_estado: {}, por_fuente: {} }));
  t.mock.method(command, "seguimientos", async () => ({ total: 0, items: [] }));
  t.mock.method(command, "lastClosedTomorrowQueue", async () => null);
  t.mock.method(command, "recordatoriosPendientes", async () => []);
}

test("esDeHoyBogota: mismo dia calendario en Bogota da true", () => {
  const hoyMismaHora = new Date().toISOString();
  assert.strictEqual(sofiComando.esDeHoyBogota(hoyMismaHora), true);
});

test("esDeHoyBogota: hace semanas da false", () => {
  const haceSemanas = new Date(Date.now() - 20 * 86400000).toISOString();
  assert.strictEqual(sofiComando.esDeHoyBogota(haceSemanas), false);
});

test("esDeHoyBogota: sin fecha (sesion nunca usada) da false, no truena", () => {
  assert.strictEqual(sofiComando.esDeHoyBogota(null), false);
});

test("openSession: sesion nueva sin mensajes SI genera el briefing", async (t) => {
  mockConsultasBriefing(t);
  t.mock.method(command, "ensureSession", async () => ({ id: "sess-1" }));
  t.mock.method(command, "getRecentCommandMessages", async () => []);
  const appends = [];
  t.mock.method(command, "appendCommandMessage", async (sessionId, role, content) => {
    appends.push({ sessionId, role, content });
    return { id: "m1" };
  });
  t.mock.method(command, "getUserCommandMessages", async () => ({ messages: [{ id: "m1" }], hasMore: false }));

  await sofiComando.openSession(SCOPE, { userName: "Katherine" });

  assert.strictEqual(appends.length, 1);
  assert.strictEqual(appends[0].role, "assistant");
});

test("openSession: sesion abandonada (ultimo mensaje de hace semanas) TAMBIEN regenera el briefing — el bug real", async (t) => {
  mockConsultasBriefing(t);
  t.mock.method(command, "ensureSession", async () => ({ id: "sess-vieja" }));
  t.mock.method(command, "getRecentCommandMessages", async () => [
    { id: "m-vieja", role: "assistant", created_at: new Date(Date.now() - 20 * 86400000).toISOString() },
  ]);
  const appends = [];
  t.mock.method(command, "appendCommandMessage", async (sessionId, role, content) => {
    appends.push({ sessionId, role, content });
    return { id: "m-nueva" };
  });
  t.mock.method(command, "getUserCommandMessages", async () => ({ messages: [{ id: "m-nueva" }], hasMore: false }));

  await sofiComando.openSession(SCOPE, { userName: "Katherine" });

  assert.strictEqual(appends.length, 1, "sin el fix, esto se queda en 0 y el chat se ve vacio para siempre");
  assert.strictEqual(appends[0].sessionId, "sess-vieja");
});

test("openSession: si el ultimo mensaje YA es de hoy, no duplica el briefing", async (t) => {
  mockConsultasBriefing(t);
  t.mock.method(command, "ensureSession", async () => ({ id: "sess-hoy" }));
  t.mock.method(command, "getRecentCommandMessages", async () => [
    { id: "m-hoy", role: "assistant", created_at: new Date().toISOString() },
  ]);
  const appends = [];
  t.mock.method(command, "appendCommandMessage", async (sessionId, role, content) => {
    appends.push({ sessionId, role, content });
    return { id: "x" };
  });
  t.mock.method(command, "getUserCommandMessages", async () => ({ messages: [{ id: "m-hoy" }], hasMore: false }));

  await sofiComando.openSession(SCOPE, { userName: "Katherine" });

  assert.strictEqual(appends.length, 0, "el briefing de hoy ya existe, no hay que duplicarlo");
});
