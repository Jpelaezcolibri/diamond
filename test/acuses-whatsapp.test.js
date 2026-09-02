// Los acuses de WhatsApp (Juan, 2026-09-02, hallazgo #4).
//
// Hasta hoy `if (value?.statuses) return;` — "enviado" solo decia que Meta
// acepto el POST. Con esto, "enviado" pasa a "entregado" o "leido", y a
// "fallido" con el motivo cuando Meta lo rechaza despues.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const memory = require("../src/data/memory");
const conversations = require("../src/data/conversations");
const { registrarAcuses } = require("../src/channels/whatsapp");

function limpiar() {
  memory.messages.length = 0;
}
function saliente(wamid, delivery = "sent") {
  memory.messages.push({ conversation_id: "c1", role: "assistant", content: "x", wa_message_id: wamid, delivery });
  return memory.messages[memory.messages.length - 1];
}

beforeEach(limpiar);

test("entregado y leido avanzan el estado", async () => {
  const m = saliente("wamid.1");
  await registrarAcuses([{ id: "wamid.1", status: "delivered" }]);
  assert.strictEqual(m.delivery, "delivered");
  await registrarAcuses([{ id: "wamid.1", status: "read" }]);
  assert.strictEqual(m.delivery, "read");
});

test("un acuse tardio no retrocede: 'entregado' despues de 'leido' se ignora", async () => {
  const m = saliente("wamid.1", "read");
  const n = await registrarAcuses([{ id: "wamid.1", status: "delivered" }]);
  assert.strictEqual(m.delivery, "read");
  assert.strictEqual(n, 0);
});

test("fallido siempre pisa y guarda el motivo — es el caso de la ventana cerrada", async () => {
  const m = saliente("wamid.1", "delivered");
  await registrarAcuses([
    { id: "wamid.1", status: "failed", errors: [{ code: 131047, title: "Re-engagement message" }] },
  ]);
  assert.strictEqual(m.delivery, "failed");
  assert.strictEqual(m.delivery_error, "(#131047) Re-engagement message");
});

test("un acuse de un wamid desconocido, o malformado, no revienta nada", async () => {
  const n = await registrarAcuses([{ id: "nadie" , status: "read" }, { status: "read" }, null, { id: "x", status: "raro" }]);
  assert.strictEqual(n, 0);
});

test("setDeliveryPorWamid rechaza estados que no conoce", async () => {
  saliente("wamid.1");
  assert.strictEqual(await conversations.setDeliveryPorWamid("wamid.1", "inventado"), false);
});
