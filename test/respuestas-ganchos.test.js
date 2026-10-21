const { test } = require("node:test");
const assert = require("node:assert");
process.env.RADAR_DM_CLASIFICAR = "false";
const rp = require("../src/groups/respuestas-publicacion");
const dm = require("../src/groups/dm");
const engine = require("../src/agent/engine");
const groupSignals = require("../src/data/group-signals");
const lineaDm = require("../src/data/linea-dm");
const puente = require("../src/groups/puente-sofi");

test("dm.procesarMensaje registra la respuesta por la linea con el pedido ligado", async (t) => {
  t.mock.method(groupSignals, "buscarPorLid", async () => null);
  t.mock.method(lineaDm, "create", async () => ({ mensaje: { id: "dm-1", created_at: "2026-10-21T13:00:00Z" }, duplicado: false }));
  t.mock.method(puente, "tenderPuente", async () => ({ resultado: "sin_senal" }));
  const llamado = t.mock.method(rp, "deLinea", async () => null);
  await dm.procesarMensaje({ id: "org-1" }, { waMessageId: "w1", sesion: "DaianaDiamond", remitenteLid: "1@lid", remitenteTelefono: null, remitenteNombre: "Laura", texto: "¿sigue la 10505566?" });
  const a = llamado.mock.calls[0].arguments[1];
  assert.strictEqual(a.texto, "¿sigue la 10505566?");
  assert.strictEqual(a.senalId, null);
  assert.deepStrictEqual(a.identidad, { telefono: null, lid: "1@lid" });
});

test("dm.procesarMensaje: si deLinea revienta, el puente igual corre", async (t) => {
  t.mock.method(groupSignals, "buscarPorLid", async () => null);
  t.mock.method(lineaDm, "create", async () => ({ mensaje: { id: "dm-2" }, duplicado: false }));
  const p = t.mock.method(puente, "tenderPuente", async () => ({ resultado: "sin_senal" }));
  t.mock.method(rp, "deLinea", async () => { throw new Error("boom"); });
  await dm.procesarMensaje({ id: "org-1" }, { waMessageId: "w2", sesion: "x", remitenteLid: "1@lid", remitenteNombre: "L", texto: "hola" });
  assert.strictEqual(p.mock.calls.length, 1);
});

test("engine.registrarRespuestaSofi llama deSofi con lead y telefono (colega incluido)", async (t) => {
  const llamado = t.mock.method(rp, "deSofi", async () => null);
  await engine.registrarRespuestaSofi({ id: "org-1" }, { id: "lead-1", nombre: "Ana" }, "573001112222", "vi en un grupo la Ref 10505566");
  assert.deepStrictEqual(llamado.mock.calls[0].arguments[1], { texto: "vi en un grupo la Ref 10505566", telefono: "573001112222", nombre: "Ana", leadId: "lead-1" });
});

test("engine.registrarRespuestaSofi no lanza si deSofi revienta", async (t) => {
  t.mock.method(rp, "deSofi", async () => { throw new Error("boom"); });
  await engine.registrarRespuestaSofi({ id: "o" }, { id: "l" }, "57", "x");
});
