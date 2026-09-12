// El CRM pregunta si el carril de amoblados esta prendido (spec 2026-09-12).
// Se toma el handler del router real, igual que test/whatsapp-usuario-sin-telefono.test.js.
const { test } = require("node:test");
const assert = require("node:assert");
const router = require("../src/api/crm");

function handler() {
  const capa = router.stack.find((c) => c.route?.path === "/api/grupos/amoblados/estado" && c.route.methods.post);
  assert.ok(capa, "No existe POST /api/grupos/amoblados/estado");
  return capa.route.stack[capa.route.stack.length - 1].handle;
}

async function llamar() {
  let cuerpo = null;
  const res = { json: (b) => { cuerpo = b; return res; }, status: () => res };
  await handler()({ body: {} }, res);
  return cuerpo;
}

function conEnv(t, valor) {
  const previo = process.env.RADAR_AMOBLADO_ACTIVO;
  if (valor === undefined) delete process.env.RADAR_AMOBLADO_ACTIVO;
  else process.env.RADAR_AMOBLADO_ACTIVO = valor;
  t.after(() => {
    if (previo === undefined) delete process.env.RADAR_AMOBLADO_ACTIVO;
    else process.env.RADAR_AMOBLADO_ACTIVO = previo;
  });
}

test("carril apagado: activo false", async (t) => {
  conEnv(t, "false");
  const r = await llamar();
  assert.strictEqual(r.activo, false);
  assert.strictEqual(typeof r.umbral, "number");
});

test("sin variable: el carril esta prendido (mismo default que carril-arriendo.js)", async (t) => {
  conEnv(t, undefined);
  assert.strictEqual((await llamar()).activo, true);
});
