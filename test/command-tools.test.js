const { test } = require("node:test");
const assert = require("node:assert");
const { executeCommandTool } = require("../src/agent/sofi-comando-tools");
const command = require("../src/data/command");

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
