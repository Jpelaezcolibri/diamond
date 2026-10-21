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
    then: (ok) => ok({ error: null }),
  };
  llamadas.push(c);
  return proxy;
}
delete require.cache[supabasePath];
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: { from: (t) => cadena(t) } };

const conversations = require("../src/data/conversations");
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
  assert.deepStrictEqual(lead.ops.find((o) => o[0] === "in"), ["in", "atencion_pendiente", ["pide_asesor", "transferido"]]);
});
