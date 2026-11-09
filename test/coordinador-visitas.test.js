// Quien "coordina las visitas" para el colega (caso Nancy, 2026-11-06): Sofi
// le dijo "Asesor 1 te la confirma" cuando la cita estaba con Asesor 3. Con
// una cita viva, el alias es el de quien la tiene; si no, la asesora principal.
const { test } = require("node:test");
const assert = require("node:assert");
const { resolverCoordinador } = require("../src/lib/coordinador-visitas");

const ORG = { id: "org-1", name: "Diamond" };
const A1 = { id: "a1", name: "Daiana", alias_publico: "Asesor 1" };
const A3 = { id: "a3", name: "Catherine", alias_publico: "Asesor 3" };
const data = { findById: async (_o, id) => (id === "a3" ? A3 : null), findAsesorPrincipalRadar: async () => A1 };

test("con la cita propuesta, el coordinador es quien la tiene", async () => {
  const c = await resolverCoordinador({ org: ORG, lead: { cita: { estado: "propuesta", asesor_id: "a3" } }, data });
  assert.deepStrictEqual(c, { advisor: A3 });
});

test("sin cita, o cancelada, es la asesora principal", async () => {
  assert.deepStrictEqual(await resolverCoordinador({ org: ORG, lead: { cita: null }, data }), { advisor: A1 });
  assert.deepStrictEqual(await resolverCoordinador({ org: ORG, lead: { cita: { estado: "cancelada", asesor_id: "a3" } }, data }), { advisor: A1 });
});

test("si la asesora de la cita no se encuentra cae a la principal; si nada se resuelve, null", async () => {
  assert.deepStrictEqual(await resolverCoordinador({ org: ORG, lead: { cita: { estado: "propuesta", asesor_id: "zz" } }, data }), { advisor: A1 });
  const vacio = {
    findById: async () => null,
    findAsesorPrincipalRadar: async () => {
      throw new Error("db");
    },
  };
  assert.strictEqual(await resolverCoordinador({ org: ORG, lead: { cita: null }, data: vacio }), null);
});
