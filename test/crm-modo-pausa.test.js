// Desde 2026-10-21 la transferencia deja la conversacion en modo humano. El
// control del CRM tiene que seguir funcionando igual: "Devolver a Sofi" la
// pasa a bot, y la asesora que le escribe al cliente da por atendido el
// pendiente (transferido / pide asesor) sin tocar "Tomar control".
const { test } = require("node:test");
const assert = require("node:assert");

const supabasePath = require.resolve("../src/data/supabase");
const llamadas = [];
function cadena(tabla) {
  const c = { tabla, ops: [] };
  const paso = (op) => (...args) => {
    c.ops.push([op, ...args]);
    return proxy;
  };
  const proxy = {
    update: paso("update"),
    eq: paso("eq"),
    in: paso("in"),
    select: paso("select"),
    single: () => Promise.resolve({ data: tabla === "conversations" ? CONV : null, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (ok) => ok({ error: null }),
  };
  llamadas.push(c);
  return proxy;
}
delete require.cache[supabasePath];
const CONV = {
  id: "conv-1", org_id: "org-1", lead_id: "lead-1", whatsapp_phone_id: "PID",
  leads: { id: "lead-1", phone: "573125550000" },
  organizations: { id: "org-1", name: "Diamond", whatsapp_token: "tok", whatsapp_phone_id: "PID" },
};
const storage = {
  from: () => ({
    upload: async () => ({ error: null }),
    getPublicUrl: () => ({ data: { publicUrl: "https://x/media/out/a.jpg" } }),
  }),
};
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: { from: (t) => cadena(t), storage } };

const conversations = require("../src/data/conversations");
const pausaTransferencia = require("../src/lib/pausa-transferencia");
const router = require("../src/api/crm");

function rutaDe(path) {
  const capa = router.stack.find((c) => c.route?.path === path && c.route.methods.post);
  assert.ok(capa, `No existe POST ${path}`);
  return capa.route.stack[capa.route.stack.length - 1].handle;
}
function respuesta() {
  const r = { codigo: 200, cuerpo: null };
  r.status = (c) => ((r.codigo = c), r);
  r.json = (b) => ((r.cuerpo = b), r);
  return r;
}

test("Devolver a Sofi sigue pasando la conversacion a bot", async (t) => {
  llamadas.length = 0;
  const setModo = t.mock.method(conversations, "setModo", async (id, modo) => ({ id, modo, lead_id: "lead-1" }));
  const res = respuesta();
  await rutaDe("/api/conversations/:id/modo")({ params: { id: "conv-1" }, body: { modo: "bot" } }, res);
  assert.strictEqual(res.codigo, 200);
  assert.deepStrictEqual(res.cuerpo, { ok: true, modo: "bot" });
  assert.deepStrictEqual(setModo.mock.calls[0].arguments, ["conv-1", "bot"]);
  assert.strictEqual(llamadas.filter((c) => c.tabla === "leads").length, 0, "devolver a Sofi no toca el pendiente");
});

test("Tomar control sigue limpiando el pendiente de transferido / pide asesor", async (t) => {
  llamadas.length = 0;
  t.mock.method(conversations, "setModo", async (id, modo) => ({ id, modo, lead_id: "lead-1" }));
  const res = respuesta();
  await rutaDe("/api/conversations/:id/modo")({ params: { id: "conv-1" }, body: { modo: "humano" } }, res);
  const lead = llamadas.find((c) => c.tabla === "leads");
  assert.ok(lead);
  assert.deepStrictEqual(lead.ops.find((o) => o[0] === "in"), ["in", "atencion_pendiente", ["pide_asesor", "transferido", "sin_respuesta"]]);
});

function graphOk(t) {
  const enviados = [];
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    enviados.push(String(url));
    if (String(url).endsWith("/media")) return { ok: true, status: 200, json: async () => ({ id: "media-1" }) };
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.OUT" }] }) };
  });
  return enviados;
}
function limpiezaDeLead() {
  const lead = llamadas.find((c) => c.tabla === "leads" && c.ops.some((o) => o[0] === "update"));
  return lead ? lead.ops : null;
}

test("la asesora escribe desde el CRM (/send): limpia el pendiente y la pausa por transferencia", async (t) => {
  llamadas.length = 0;
  graphOk(t);
  t.mock.method(conversations, "appendMessage", async () => ({ id: "m1" }));
  t.mock.method(conversations, "setDelivery", async () => {});
  const limpiar = t.mock.method(pausaTransferencia, "limpiar", async () => true);
  const res = respuesta();
  await rutaDe("/api/conversations/:id/send")({ params: { id: "conv-1" }, body: { text: "Hola Laura, soy Daiana" } }, res);
  assert.deepStrictEqual(res.cuerpo, { ok: true, delivery: "sent" });
  const ops = limpiezaDeLead();
  assert.ok(ops, "se actualiza el lead");
  assert.deepStrictEqual(ops.find((o) => o[0] === "update")[1], { atencion_pendiente: null, atencion_desde: null });
  assert.deepStrictEqual(ops.find((o) => o[0] === "in"), ["in", "atencion_pendiente", ["pide_asesor", "transferido", "sin_respuesta"]]);
  assert.deepStrictEqual(limpiar.mock.calls[0].arguments[0], { orgId: "org-1", leadId: "lead-1" });
});

test("si el /send no salio, el pendiente y la pausa quedan", async (t) => {
  llamadas.length = 0;
  t.mock.method(globalThis, "fetch", async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "fuera de ventana" } }) }));
  t.mock.method(conversations, "appendMessage", async () => ({ id: "m1" }));
  t.mock.method(conversations, "setDelivery", async () => {});
  const limpiar = t.mock.method(pausaTransferencia, "limpiar", async () => true);
  const res = respuesta();
  await rutaDe("/api/conversations/:id/send")({ params: { id: "conv-1" }, body: { text: "Hola" } }, res);
  assert.strictEqual(res.cuerpo.delivery, "failed");
  assert.strictEqual(limpiezaDeLead(), null);
  assert.strictEqual(limpiar.mock.calls.length, 0);
});

test("la asesora manda una imagen desde el CRM (/media): tambien limpia el pendiente y la pausa", async (t) => {
  llamadas.length = 0;
  graphOk(t);
  t.mock.method(conversations, "appendMessage", async () => ({ id: "m2" }));
  const limpiar = t.mock.method(pausaTransferencia, "limpiar", async () => true);
  const res = respuesta();
  const req = { params: { id: "conv-1" }, body: {}, file: { buffer: Buffer.from("x"), mimetype: "image/jpeg", originalname: "a.jpg" } };
  await rutaDe("/api/conversations/:id/media")(req, res);
  assert.deepStrictEqual(res.cuerpo, { ok: true });
  assert.ok(limpiezaDeLead(), "se limpia el pendiente");
  assert.strictEqual(limpiar.mock.calls.length, 1);
});

test("tomar control borra la pausa por transferencia; devolver a Sofi no la toca", async (t) => {
  t.mock.method(conversations, "setModo", async (id, modo) => ({ id, modo, org_id: "org-1", lead_id: "lead-1" }));
  const limpiar = t.mock.method(pausaTransferencia, "limpiar", async () => true);
  await rutaDe("/api/conversations/:id/modo")({ params: { id: "conv-1" }, body: { modo: "humano" } }, respuesta());
  assert.deepStrictEqual(limpiar.mock.calls[0].arguments[0], { orgId: "org-1", leadId: "lead-1" });
  await rutaDe("/api/conversations/:id/modo")({ params: { id: "conv-1" }, body: { modo: "bot" } }, respuesta());
  assert.strictEqual(limpiar.mock.calls.length, 1);
});
