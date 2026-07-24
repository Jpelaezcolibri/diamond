// Marcar propiedades a nombre de un asesor via Sofi-Comando. Cualquier rol
// puede marcar (decision 2026-07-24). Mismo criterio de mock que
// command-recordatorios-tool.test.js.
const { test } = require("node:test");
const assert = require("node:assert");
const { executeCommandTool } = require("../src/agent/sofi-comando-tools");
const properties = require("../src/data/properties");
const advisors = require("../src/data/advisors");

function asesorScope() {
  return Object.freeze({ orgId: "org-1", viewerUid: "uid-asesor-1", role: "asesor_ventas", isAdmin: false });
}

const PROP = { id: "prop-1", ref: "10207832", titulo: "Apto en Laureles", zona: "Laureles", captador_id: null };
const NATALIA = { id: "adv-9", name: "Natalia Velez", phone: "573009998877", activo: true };

test("marcar_propiedad: cualquier rol marca y confirma con nombre y ref", async (t) => {
  t.mock.method(properties, "findByRef", async (orgId, ref) => {
    assert.strictEqual(orgId, "org-1");
    assert.strictEqual(ref, "10207832");
    return { ...PROP };
  });
  t.mock.method(advisors, "searchByName", async () => [NATALIA]);
  const set = t.mock.method(properties, "setCaptador", async (orgId, propertyId, advisorId) => {
    assert.strictEqual(propertyId, "prop-1");
    assert.strictEqual(advisorId, "adv-9");
    return { ...PROP, captador_id: "adv-9" };
  });
  const out = await executeCommandTool("marcar_propiedad", { ref: "10207832", asesor: "Natalia" }, { scope: asesorScope(), session: null });
  assert.strictEqual(set.mock.calls.length, 1);
  assert.match(out, /Natalia Velez/);
  assert.match(out, /10207832/);
});

test("marcar_propiedad: ref inexistente no marca nada", async (t) => {
  t.mock.method(properties, "findByRef", async () => null);
  const set = t.mock.method(properties, "setCaptador", async () => null);
  const out = await executeCommandTool("marcar_propiedad", { ref: "999", asesor: "Natalia" }, { scope: asesorScope(), session: null });
  assert.strictEqual(set.mock.calls.length, 0);
  assert.match(out, /No encontre la referencia 999/);
});

test("marcar_propiedad: asesor inexistente vuelve a preguntar", async (t) => {
  t.mock.method(properties, "findByRef", async () => ({ ...PROP }));
  t.mock.method(advisors, "searchByName", async () => []);
  const set = t.mock.method(properties, "setCaptador", async () => null);
  const out = await executeCommandTool("marcar_propiedad", { ref: "10207832", asesor: "Karolina" }, { scope: asesorScope(), session: null });
  assert.strictEqual(set.mock.calls.length, 0);
  assert.match(out, /No encontre ningun asesor/);
});

test("marcar_propiedad: nombre ambiguo pide precisar sin marcar", async (t) => {
  t.mock.method(properties, "findByRef", async () => ({ ...PROP }));
  t.mock.method(advisors, "searchByName", async () => [NATALIA, { id: "adv-10", name: "Natalia Gomez", phone: "5730011", activo: true }]);
  const set = t.mock.method(properties, "setCaptador", async () => null);
  const out = await executeCommandTool("marcar_propiedad", { ref: "10207832", asesor: "Natalia" }, { scope: asesorScope(), session: null });
  assert.strictEqual(set.mock.calls.length, 0);
  assert.match(out, /Natalia Velez/);
  assert.match(out, /Natalia Gomez/);
});

test("marcar_propiedad: reasignar menciona al captador anterior", async (t) => {
  t.mock.method(properties, "findByRef", async () => ({ ...PROP, captador_id: "adv-1" }));
  t.mock.method(advisors, "searchByName", async () => [NATALIA]);
  t.mock.method(advisors, "findById", async () => ({ id: "adv-1", name: "Pedro Ruiz", activo: true }));
  t.mock.method(properties, "setCaptador", async () => ({ ...PROP, captador_id: "adv-9" }));
  const out = await executeCommandTool("marcar_propiedad", { ref: "10207832", asesor: "Natalia" }, { scope: asesorScope(), session: null });
  assert.match(out, /Pedro Ruiz/);
});

test("consultar_captador por ref responde el dueño", async (t) => {
  t.mock.method(properties, "findByRef", async () => ({ ...PROP, captador_id: "adv-9" }));
  t.mock.method(advisors, "findById", async () => NATALIA);
  const out = await executeCommandTool("consultar_captador", { ref: "10207832" }, { scope: asesorScope(), session: null });
  assert.match(out, /Natalia Velez/);
});

test("consultar_captador por ref sin captador lo dice", async (t) => {
  t.mock.method(properties, "findByRef", async () => ({ ...PROP }));
  const out = await executeCommandTool("consultar_captador", { ref: "10207832" }, { scope: asesorScope(), session: null });
  assert.match(out, /no tiene captador/);
});

test("consultar_captador por asesor lista sus propiedades", async (t) => {
  t.mock.method(advisors, "searchByName", async () => [NATALIA]);
  t.mock.method(properties, "listByCaptador", async (orgId, advisorId) => {
    assert.strictEqual(advisorId, "adv-9");
    return [{ ref: "10207832", titulo: "Apto en Laureles", zona: "Laureles" }];
  });
  const out = await executeCommandTool("consultar_captador", { asesor: "Natalia" }, { scope: asesorScope(), session: null });
  assert.match(out, /10207832/);
});
