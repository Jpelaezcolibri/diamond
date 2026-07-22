// Registro de propiedades de colegas desde Sofi-Comando (el asesor, no el
// colega, es quien la registra) — mismo criterio de mock que
// command-advisor-tools.test.js: el scope viene del ctx del servidor.
const { test } = require("node:test");
const assert = require("node:assert");
const { executeCommandTool } = require("../src/agent/sofi-comando-tools");
const allyProperties = require("../src/data/ally-properties");

function asesorScope() {
  return Object.freeze({ orgId: "org-1", viewerUid: "uid-asesor-1", role: "asesor_ventas", isAdmin: false });
}

test("registrar_propiedad_colega: guarda la propiedad con registrado_por = el asesor logueado", async (t) => {
  const created = [];
  t.mock.method(allyProperties, "create", async (orgId, fields) => {
    created.push({ orgId, fields });
    return { id: "ally-9", ...fields };
  });

  const input = {
    tipo: "Apartamento",
    operacion: "Arriendo",
    zona: "Laureles",
    precio: "$1.800.000",
    inmobiliaria_origen: "Century21",
    contacto_nombre: "Andrea Restrepo",
  };
  const out = await executeCommandTool("registrar_propiedad_colega", input, { scope: asesorScope(), session: null });

  assert.strictEqual(created.length, 1);
  assert.strictEqual(created[0].orgId, "org-1");
  assert.strictEqual(created[0].fields.registrado_por, "uid-asesor-1");
  assert.strictEqual(created[0].fields.contacto_nombre, "Andrea Restrepo");
  assert.match(out, /Andrea Restrepo/);
});
