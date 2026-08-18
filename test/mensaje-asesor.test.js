// Todo lo que Sofi le manda a un asesor (radar, Sofi-Comando, recordatorios)
// pasa por aca — el punto de esta sesion del 2026-08-18: antes se mandaba
// directo por canalWhatsapp.sendWhatsApp y no quedaba ningun rastro. Juan lo
// encontro pidiendo ver, en el Inbox, un mensaje de prueba que se le habia
// mandado a Catherine y no aparecia.

const { test } = require("node:test");
const assert = require("node:assert");
const { enviarYRegistrar } = require("../src/lib/mensaje-asesor");
const leads = require("../src/data/leads");
const conversations = require("../src/data/conversations");
const canalWhatsapp = require("../src/channels/whatsapp");

const ORG = { id: "org-1" };

test("crea (o retoma) el lead del asesor con source='asesor', no un lead de cliente", async (t) => {
  t.mock.method(leads, "findOrCreate", async (orgId, phone, source) => {
    assert.strictEqual(orgId, "org-1");
    assert.strictEqual(phone, "573028536489");
    assert.strictEqual(source, "asesor");
    return { id: "lead-1" };
  });
  t.mock.method(conversations, "findOrCreate", async () => ({ id: "conv-1" }));
  t.mock.method(conversations, "appendMessage", async () => ({ id: "msg-1" }));
  t.mock.method(conversations, "setDelivery", async () => {});
  t.mock.method(canalWhatsapp, "sendWhatsApp", async () => ({ ok: true, wamid: "w1" }));

  await enviarYRegistrar(ORG, "573028536489", "hola");
});

test("el mensaje se guarda ANTES de intentar el envio — si el envio revienta, igual queda registrado", async (t) => {
  t.mock.method(leads, "findOrCreate", async () => ({ id: "lead-1" }));
  t.mock.method(conversations, "findOrCreate", async () => ({ id: "conv-1" }));
  let guardado = null;
  t.mock.method(conversations, "appendMessage", async (convId, role, content) => {
    guardado = { convId, role, content };
    return { id: "msg-1" };
  });
  let delivery = null;
  t.mock.method(conversations, "setDelivery", async (msgId, estado, error) => { delivery = { msgId, estado, error }; });
  t.mock.method(canalWhatsapp, "sendWhatsApp", async () => { throw new Error("timeout de red"); });

  const r = await enviarYRegistrar(ORG, "573028536489", "hola Catherine");

  assert.strictEqual(r.ok, false);
  assert.strictEqual(guardado.role, "assistant");
  assert.strictEqual(guardado.content, "hola Catherine");
  assert.strictEqual(delivery.estado, "failed");
  assert.match(delivery.error, /timeout/);
});

test("con envio exitoso, marca delivery=sent y guarda el wamid", async (t) => {
  t.mock.method(leads, "findOrCreate", async () => ({ id: "lead-1" }));
  t.mock.method(conversations, "findOrCreate", async () => ({ id: "conv-1" }));
  t.mock.method(conversations, "appendMessage", async () => ({ id: "msg-1" }));
  let delivery = null;
  let wamidGuardado = null;
  t.mock.method(conversations, "setDelivery", async (msgId, estado) => { delivery = estado; });
  t.mock.method(conversations, "setWaMessageId", async (msgId, wamid) => { wamidGuardado = wamid; });
  t.mock.method(canalWhatsapp, "sendWhatsApp", async () => ({ ok: true, wamid: "wamid.ABC" }));

  const r = await enviarYRegistrar(ORG, "573028536489", "hola");

  assert.strictEqual(r.ok, true);
  assert.strictEqual(delivery, "sent");
  assert.strictEqual(wamidGuardado, "wamid.ABC");
});

test("con la ventana de 24h cerrada, marca delivery=failed y no truena", async (t) => {
  t.mock.method(leads, "findOrCreate", async () => ({ id: "lead-1" }));
  t.mock.method(conversations, "findOrCreate", async () => ({ id: "conv-1" }));
  t.mock.method(conversations, "appendMessage", async () => ({ id: "msg-1" }));
  let delivery = null;
  t.mock.method(conversations, "setDelivery", async (msgId, estado) => { delivery = estado; });
  t.mock.method(canalWhatsapp, "sendWhatsApp", async () => ({ ok: false, error: "ventana cerrada" }));

  const r = await enviarYRegistrar(ORG, "573028536489", "hola");

  assert.strictEqual(r.ok, false);
  assert.strictEqual(delivery, "failed");
});
