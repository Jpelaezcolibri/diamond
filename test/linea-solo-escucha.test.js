// La línea de Natalia solo escucha (Juan, 2026-11-11): "actívalos desde la
// línea de Natalia, que Sofi tome el requerimiento y que conteste desde la
// línea de Sofi o de Daiana directamente al interno del colega, sin necesidad
// de responder desde la línea de Natalia". Los 3 grupos que más pedidos traían
// (Pedidos Poblado/Envigado, PEDIDOS - BUSCANDO, PEDIDOS -Buscando PEDIDOS)
// están mudos desde el 10-sep porque la línea de Daiana no está en ellos.
const { test, afterEach } = require("node:test");
const assert = require("node:assert");
const waha = require("../src/lib/waha");
const lineas = require("../src/lib/lineas-radar");
const memory = require("../src/data/memory");
const whatsappGroups = require("../src/data/whatsapp-groups");
const colegasData = require("../src/data/colegas");

const ENV = { WAHA_URL: process.env.WAHA_URL, WAHA_API_KEY: process.env.WAHA_API_KEY };
const fetchReal = globalThis.fetch;
function conWaha() {
  process.env.WAHA_URL = "http://waha.test:8080";
  process.env.WAHA_API_KEY = "clave";
  const llamadas = [];
  globalThis.fetch = async (url, init) => {
    llamadas.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: { _serialized: "wamid-x" } }) };
  };
  return llamadas;
}
afterEach(() => {
  globalThis.fetch = fetchReal;
  process.env.WAHA_URL = ENV.WAHA_URL || "";
  process.env.WAHA_API_KEY = ENV.WAHA_API_KEY || "";
  delete process.env.RADAR_SESIONES_SOLO_ESCUCHA;
  delete process.env.RADAR_SESION_SALIDA;
});

test("qué línea solo escucha y por cuál sale lo que esa línea no puede mandar", () => {
  process.env.RADAR_SESIONES_SOLO_ESCUCHA = "RADA-NATALIA";
  process.env.RADAR_SESION_SALIDA = "DaianaDiamond";
  assert.strictEqual(lineas.esSoloEscucha("RADA-NATALIA"), true);
  assert.strictEqual(lineas.esSoloEscucha("DaianaDiamond"), false);
  assert.strictEqual(lineas.sesionDeSalida("RADA-NATALIA"), "DaianaDiamond");
  assert.strictEqual(lineas.sesionDeSalida("DaianaDiamond"), "DaianaDiamond");
  delete process.env.RADAR_SESION_SALIDA;
  assert.strictEqual(lineas.sesionDeSalida("RADA-NATALIA"), null, "sin línea de salida no se adivina");
});

test("un DM pedido desde la línea de Natalia sale por la de Daiana", async (t) => {
  t.mock.method(colegasData, "esSoloLlamada", async () => false);
  process.env.RADAR_SESIONES_SOLO_ESCUCHA = "RADA-NATALIA";
  process.env.RADAR_SESION_SALIDA = "DaianaDiamond";
  const llamadas = conWaha();
  const r = await waha.enviarDm("RADA-NATALIA", null, "hola colega", { lid: "269230108872829@lid", orgId: "org-1" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(llamadas.length, 1);
  assert.strictEqual(llamadas[0].body.session, "DaianaDiamond");
  assert.strictEqual(r.sesion, "DaianaDiamond", "devuelve por dónde salió");
});

test("sin línea de salida, la de Natalia no manda nada (falla cerrado)", async (t) => {
  t.mock.method(colegasData, "esSoloLlamada", async () => false);
  process.env.RADAR_SESIONES_SOLO_ESCUCHA = "RADA-NATALIA";
  const llamadas = conWaha();
  const r = await waha.enviarDm("RADA-NATALIA", null, "hola", { lid: "269230108872829@lid", orgId: "org-1" });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /solo escucha/);
  assert.strictEqual(llamadas.length, 0);
});

test("la línea de Natalia nunca publica en un grupo", async () => {
  process.env.RADAR_SESIONES_SOLO_ESCUCHA = "RADA-NATALIA";
  process.env.RADAR_SESION_SALIDA = "DaianaDiamond";
  const llamadas = conWaha();
  const r = await waha.enviarTexto("RADA-NATALIA", "120363000000000000@g.us", "post");
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /solo escucha/);
  assert.strictEqual(llamadas.length, 0);
});

test("sin la variable, todo sigue como antes", async (t) => {
  t.mock.method(colegasData, "esSoloLlamada", async () => false);
  const llamadas = conWaha();
  const r = await waha.enviarDm("RADA-NATALIA", null, "hola", { lid: "269230108872829@lid", orgId: "org-1" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(llamadas[0].body.session, "RADA-NATALIA");
});

test("la línea que solo escucha no cuenta como 'activa': lo que exige una sola línea sigue viendo la de Daiana", async () => {
  process.env.RADAR_SESIONES_SOLO_ESCUCHA = "RADA-NATALIA";
  memory.whatsappSessions.length = 0;
  memory.whatsappSessions.push(
    { id: "s1", org_id: "org-1", nombre: "DaianaDiamond", estado: "activa", rol: "dedicada" },
    { id: "s2", org_id: "org-1", nombre: "RADA-NATALIA", estado: "activa", rol: "dedicada" },
  );
  const sesiones = await whatsappGroups.listSessions("org-1");
  const activas = sesiones.filter((s) => s.estado === "activa");
  assert.deepStrictEqual(activas.map((s) => s.nombre), ["DaianaDiamond"]);
  const natalia = sesiones.find((s) => s.nombre === "RADA-NATALIA");
  assert.strictEqual(natalia.estado, "escucha");
  assert.strictEqual(natalia.soloEscucha, true);
  assert.strictEqual(memory.whatsappSessions[1].estado, "activa", "no cambia lo guardado");
});

test("la cuota que frena los DM es la de la línea por donde salen, no la de Natalia", async () => {
  process.env.RADAR_SESIONES_SOLO_ESCUCHA = "RADA-NATALIA";
  process.env.RADAR_SESION_SALIDA = "DaianaDiamond";
  const llamadas = conWaha();
  await waha.cuotaDeLinea("RADA-NATALIA");
  assert.strictEqual(llamadas.length, 1);
  assert.match(llamadas[0].url, /DaianaDiamond/);
  assert.doesNotMatch(llamadas[0].url, /RADA-NATALIA/);
});
