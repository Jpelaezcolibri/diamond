const { test } = require("node:test");
const assert = require("node:assert");
const { executeCommandTool, COMMAND_TOOL_DEFINITIONS } = require("../src/agent/sofi-comando-tools");
const { buildCommandSystemPrompt } = require("../src/agent/sofi-comando-prompts");
const command = require("../src/data/command");
const properties = require("../src/data/properties");
const allyProperties = require("../src/data/ally-properties");

function asesorScope() {
  return Object.freeze({ orgId: "org-1", viewerUid: "asesor-1", role: "asesor_ventas", isAdmin: false });
}

test("consultar_seguimientos: usa el scope del ctx, ignora cualquier alcance del input", async (t) => {
  let received = null;
  t.mock.method(command, "seguimientos", async (scope, opts) => {
    received = { scope, opts };
    return { total: 0, items: [] };
  });

  const scope = asesorScope();
  // El input trae basura que intenta ampliar el alcance: debe ignorarse.
  await executeCommandTool(
    "consultar_seguimientos",
    { dias: 5, viewerUid: "otro-asesor", is_admin: true },
    { scope, session: null }
  );

  assert.strictEqual(received.scope.viewerUid, "asesor-1");
  assert.strictEqual(received.scope.isAdmin, false);
  assert.strictEqual(received.opts.dias, 5);
});

test("metricas_leads: pasa el scope del ctx al data layer", async (t) => {
  let received = null;
  t.mock.method(command, "metricasLeads", async (scope) => {
    received = scope;
    return { nuevos: 3, por_estado: {}, por_fuente: {} };
  });

  const scope = asesorScope();
  const out = await executeCommandTool("metricas_leads", {}, { scope, session: null });

  assert.strictEqual(received.viewerUid, "asesor-1");
  assert.match(out, /"nuevos":3/);
});

test("sugerir_siguiente_accion: devuelve el foco activo de la sesion", async () => {
  const session = { active_context: { propiedad_ref: "9205982" } };
  const out = await executeCommandTool("sugerir_siguiente_accion", {}, { scope: asesorScope(), session });
  assert.match(out, /9205982/);
});

test("sugerir_siguiente_accion: sin foco devuelve 'sin foco activo'", async () => {
  const out = await executeCommandTool("sugerir_siguiente_accion", {}, { scope: asesorScope(), session: null });
  assert.match(out, /sin foco activo/);
});

test("buscar_inventario: usa el orgId del scope, nunca el del input", async (t) => {
  let received = null;
  t.mock.method(properties, "search", async (orgId, filters, limit) => {
    received = { orgId, filters, limit };
    return [{ ref: "9776475", titulo: "Apartaloft cerca a Laureles", precio: "$346.000.000", disponible: true }];
  });

  const out = await executeCommandTool(
    "buscar_inventario",
    { zona: "Laureles", precio_max: 1300000000, org_id: "org-ajena" },
    { scope: asesorScope(), session: null }
  );

  assert.strictEqual(received.orgId, "org-1");
  assert.strictEqual(received.filters.zona, "Laureles");
  assert.strictEqual(received.filters.precio_max, 1300000000);
  assert.match(out, /9776475/);
});

test("buscar_inventario: con ref busca por referencia exacta (incluye no disponibles)", async (t) => {
  let received = null;
  t.mock.method(properties, "findByRef", async (orgId, ref) => {
    received = { orgId, ref };
    return { ref: "9921388", titulo: "Casa", disponible: false };
  });

  const out = await executeCommandTool("buscar_inventario", { ref: "9921388" }, { scope: asesorScope(), session: null });

  assert.strictEqual(received.orgId, "org-1");
  assert.strictEqual(received.ref, "9921388");
  assert.match(out, /9921388/);
});

test("buscar_inventario: limita el numero de resultados a 10 como maximo", async (t) => {
  let received = null;
  t.mock.method(properties, "search", async (orgId, filters, limit) => {
    received = limit;
    return [];
  });

  const out = await executeCommandTool("buscar_inventario", { limite: 50 }, { scope: asesorScope(), session: null });

  assert.strictEqual(received, 10);
  assert.match(out, /Sin resultados/);
  // Sugiere el camino alterno cuando no hay inventario propio.
  assert.match(out, /buscar_red_aliados/);
});

test("buscar_red_aliados: pasa scope y filtros, y advierte que hay que confirmar con el colega", async (t) => {
  let received = null;
  t.mock.method(allyProperties, "search", async (orgId, filters, limit) => {
    received = { orgId, filters, limit };
    return [
      {
        ref: "10128030",
        zona: "Guatape",
        precio: "$800.000.000",
        contacto_nombre: "Carlos",
        contacto_telefono: "573001112233",
        inmobiliaria_origen: "Su Casa YA",
      },
    ];
  });

  const out = await executeCommandTool(
    "buscar_red_aliados",
    { zona: "Guatape", operacion: "Venta", precio_max: 900000000 },
    { scope: asesorScope(), session: null }
  );

  assert.strictEqual(received.orgId, "org-1");
  assert.strictEqual(received.filters.operacion, "Venta");
  assert.strictEqual(received.filters.precioMax, 900000000);
  // Al asesor SI se le muestra el contacto del colega (a diferencia de Sofi-Cliente).
  assert.match(out, /Carlos/);
  assert.match(out, /confirmar disponibilidad/);
});

test("buscar_red_aliados: sin coincidencias lo dice sin inventar", async (t) => {
  t.mock.method(allyProperties, "search", async () => []);
  const out = await executeCommandTool("buscar_red_aliados", { zona: "Marte" }, { scope: asesorScope(), session: null });
  assert.match(out, /No hay propiedades de aliados/);
});

test("las tools nuevas estan definidas para el modelo y el prompt las explica", () => {
  const names = COMMAND_TOOL_DEFINITIONS.map((t) => t.name);
  assert.ok(names.includes("buscar_inventario"));
  assert.ok(names.includes("buscar_red_aliados"));

  const scope = asesorScope();
  const system = buildCommandSystemPrompt({ scope, userName: "KT", now: { legible: "viernes" } });
  const stable = system[0].text;
  assert.match(stable, /buscar_inventario/);
  assert.match(stable, /buscar_red_aliados/);
  // La geografia compartida viaja en el bloque estable (cacheado).
  assert.match(stable, /GEOGRAFIA DE MEDELLIN/);
  assert.match(stable, /Envigado NO es El Poblado/);
});
