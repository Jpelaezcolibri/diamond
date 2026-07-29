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

// ══ Escalones de confianza en Sofi-Comando ═══════════════════════════════

test("buscar_red_aliados: si hay registradas por un asesor, NO baja a las de grupo", async (t) => {
  const consultas = [];
  t.mock.method(allyProperties, "search", async (orgId, filtros) => {
    consultas.push(filtros.origen);
    return filtros.origen === "asesor" ? [{ id: "a1", zona: "Laureles" }] : [{ id: "g1", zona: "Laureles" }];
  });
  const r = await executeCommandTool("buscar_red_aliados", { zona: "Laureles" }, { scope: asesorScope(), session: null });
  assert.deepStrictEqual(consultas, ["asesor"]);
  assert.match(r, /registradas por un asesor/);
  assert.doesNotMatch(r, /NO ESTAN VERIFICADAS/);
});

test("buscar_red_aliados: las de grupo salen SIEMPRE marcadas como no verificadas", async (t) => {
  // Sin la advertencia, el asesor le ofrece a un cliente algo que Sofi leyó al
  // pasar en un grupo y que puede estar vendido hace un mes.
  t.mock.method(allyProperties, "search", async (orgId, filtros) =>
    filtros.origen === "grupo" ? [{ id: "g1", zona: "Laureles" }] : []
  );
  const r = await executeCommandTool("buscar_red_aliados", { zona: "Laureles" }, { scope: asesorScope(), session: null });
  assert.match(r, /NO ESTAN VERIFICADAS/);
  assert.match(r, /no para ofrecerselas a un cliente/);
});

test("buscar_red_aliados: sin nada en ninguno de los dos escalones lo dice explícito", async (t) => {
  t.mock.method(allyProperties, "search", async () => []);
  const r = await executeCommandTool("buscar_red_aliados", { zona: "Zona inexistente" }, { scope: asesorScope(), session: null });
  assert.match(r, /ni registradas por un asesor ni vistas en los grupos/);
});
