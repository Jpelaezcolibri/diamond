// Marcar/desmarcar urgencia de venta via Sofi-Comando (Juan, 2026-08-21: ref
// 8989725, "Directa de Diamond, con urgencia de venta"). Cualquier rol puede
// marcar, mismo criterio que marcar_propiedad. Mismo criterio de mock que
// command-marcar-propiedad.test.js.
const { test } = require("node:test");
const assert = require("node:assert");
const { executeCommandTool } = require("../src/agent/sofi-comando-tools");
const properties = require("../src/data/properties");

function asesorScope() {
  return Object.freeze({ orgId: "org-1", viewerUid: "uid-asesor-1", role: "asesor_ventas", isAdmin: false });
}

const PROP = { id: "prop-1", ref: "8989725", titulo: "Apto en El Poblado", zona: "El Poblado", prioridad_venta: false };

test("marcar_prioridad_venta: sin decir el valor, asume true", async (t) => {
  t.mock.method(properties, "findByRef", async (orgId, ref) => {
    assert.strictEqual(orgId, "org-1");
    assert.strictEqual(ref, "8989725");
    return { ...PROP };
  });
  const set = t.mock.method(properties, "setPrioridadVenta", async (orgId, propertyId, prioridad) => {
    assert.strictEqual(propertyId, "prop-1");
    assert.strictEqual(prioridad, true);
    return { ...PROP, prioridad_venta: true };
  });
  const out = await executeCommandTool("marcar_prioridad_venta", { ref: "8989725" }, { scope: asesorScope(), session: null });
  assert.strictEqual(set.mock.calls.length, 1);
  assert.match(out, /8989725/);
  assert.match(out, /urgencia de venta/);
});

test("marcar_prioridad_venta: prioridad false la quita", async (t) => {
  t.mock.method(properties, "findByRef", async () => ({ ...PROP, prioridad_venta: true }));
  const set = t.mock.method(properties, "setPrioridadVenta", async (orgId, propertyId, prioridad) => {
    assert.strictEqual(prioridad, false);
    return { ...PROP, prioridad_venta: false };
  });
  const out = await executeCommandTool("marcar_prioridad_venta", { ref: "8989725", prioridad: false }, { scope: asesorScope(), session: null });
  assert.strictEqual(set.mock.calls.length, 1);
  assert.match(out, /quite la urgencia/);
});

test("marcar_prioridad_venta: ref inexistente no marca nada", async (t) => {
  t.mock.method(properties, "findByRef", async () => null);
  const set = t.mock.method(properties, "setPrioridadVenta", async () => null);
  const out = await executeCommandTool("marcar_prioridad_venta", { ref: "999" }, { scope: asesorScope(), session: null });
  assert.strictEqual(set.mock.calls.length, 0);
  assert.match(out, /No encontre la referencia 999/);
});
