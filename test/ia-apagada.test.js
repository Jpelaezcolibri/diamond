// IA apagada (Juan, 2026-11-18): con IA_APAGADA=true ninguna pieza llama a la
// API. Sofi contesta un texto fijo una sola vez y pasa el chat a una asesora.

const { test } = require("node:test");
const assert = require("node:assert");

process.env.IA_APAGADA = "true";

const ia = require("../src/lib/ia-apagada");
const { getClient } = require("../src/lib/anthropic");

test("getClient lanza con la IA apagada (nunca se crea el cliente real)", () => {
  assert.throws(() => getClient(), ia.IaApagadaError);
});

test("Sofi en la linea del radar y el clasificador de DM quedan apagados", () => {
  process.env.RADAR_SOFI_LINEA = "true";
  process.env.RADAR_DM_CLASIFICAR = "true";
  assert.strictEqual(require("../src/groups/sofi-linea").activo(), false);
  assert.strictEqual(require("../src/groups/dm").clasificadorActivo(), false);
});

test("los seguimientos no corren", async () => {
  const r = await require("../src/scheduler/followups").runOnce();
  assert.strictEqual(r.sent, 0);
});

test("Sofi contesta el texto fijo una vez, transfiere y no se repite", async () => {
  const engine = require("../src/agent/engine");
  const org = (await require("../src/data/organizations").getDefault()) || { id: "org-test", name: "Test" };
  const tel = "573009999001";
  const r1 = await engine.procesarMensaje({ org, phone: tel, text: "Hola, me interesa la Ref 10505674" });
  assert.strictEqual(r1.reply, ia.RESPUESTA_FIJA);
  assert.ok(r1.transfer, "debe transferir a una asesora");
  assert.ok(r1.transfer.conversationId);
  assert.match(r1.transfer.motivo, /IA apagada/);

  const r2 = await engine.procesarMensaje({ org, phone: tel, text: "¿Sigue disponible?" });
  assert.strictEqual(r2.reply, null);
});

test("el texto fijo no nombra asesoras y va en tuteo", () => {
  assert.match(ia.RESPUESTA_FIJA, /un asesor de nuestro equipo/i);
  assert.doesNotMatch(ia.RESPUESTA_FIJA, /Asesor \d|Claudia|Catherine|Daiana|vos |tenés|querés/);
});
