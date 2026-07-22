// Recordatorios personales del asesor en Sofi-Comando — mismo criterio de
// mock que command-advisor-tools.test.js: el scope viene del ctx del
// servidor, y command.js (que toca Supabase real) se mockea en el consumidor.
const { test } = require("node:test");
const assert = require("node:assert");
const { executeCommandTool } = require("../src/agent/sofi-comando-tools");
const command = require("../src/data/command");

function asesorScope() {
  return Object.freeze({ orgId: "org-1", viewerUid: "uid-asesor-1", role: "asesor_ventas", isAdmin: false });
}

test("crear_recordatorio: guarda con el scope del asesor, sin cliente vinculado si no hay match unico", async (t) => {
  const created = [];
  t.mock.method(command, "crearRecordatorio", async (scope, fields) => {
    created.push({ scope, fields });
    return { id: "rec-1", ...fields };
  });
  t.mock.method(command, "buscarLeads", async () => []);

  const out = await executeCommandTool(
    "crear_recordatorio",
    { descripcion: "llamar a Pedro por el credito", fecha_hora_iso: "2026-07-23T09:00:00-05:00" },
    { scope: asesorScope(), session: null }
  );

  assert.strictEqual(created.length, 1);
  assert.strictEqual(created[0].scope.viewerUid, "uid-asesor-1");
  assert.strictEqual(created[0].fields.descripcion, "llamar a Pedro por el credito");
  assert.strictEqual(created[0].fields.leadId, null);
  assert.match(out, /Solo tu lo vas a ver/);
});

test("crear_recordatorio: si el cliente mencionado tiene un solo match, lo vincula", async (t) => {
  const created = [];
  t.mock.method(command, "crearRecordatorio", async (scope, fields) => {
    created.push(fields);
    return { id: "rec-2", ...fields };
  });
  t.mock.method(command, "buscarLeads", async (scope, q) => {
    assert.strictEqual(q, "Pedro");
    return [{ id: "lead-9", nombre: "Pedro Gomez" }];
  });

  const out = await executeCommandTool(
    "crear_recordatorio",
    { descripcion: "llamar por el credito", cliente: "Pedro" },
    { scope: asesorScope(), session: null }
  );

  assert.strictEqual(created[0].leadId, "lead-9");
  assert.match(out, /vinculado al cliente/);
});

test("consultar_recordatorios: sin pendientes lo dice con honestidad", async (t) => {
  t.mock.method(command, "recordatoriosPendientes", async () => []);
  const out = await executeCommandTool("consultar_recordatorios", {}, { scope: asesorScope(), session: null });
  assert.strictEqual(out, "No tienes recordatorios pendientes.");
});

test("consultar_recordatorios: devuelve los pendientes del scope, no de otro asesor", async (t) => {
  let scopeRecibido = null;
  t.mock.method(command, "recordatoriosPendientes", async (scope) => {
    scopeRecibido = scope;
    return [{ id: "r1", descripcion: "cita con Marta", fecha_hora: null, lead_id: null }];
  });
  const out = await executeCommandTool("consultar_recordatorios", {}, { scope: asesorScope(), session: null });
  assert.strictEqual(scopeRecibido.viewerUid, "uid-asesor-1");
  assert.match(out, /cita con Marta/);
});

test("completar_recordatorio: marca el que coincide con la referencia", async (t) => {
  let refRecibida = null;
  t.mock.method(command, "completarRecordatorio", async (scope, referencia) => {
    refRecibida = referencia;
    return { id: "r1", descripcion: "cita con Marta" };
  });
  const out = await executeCommandTool("completar_recordatorio", { referencia: "cita con Marta" }, { scope: asesorScope(), session: null });
  assert.strictEqual(refRecibida, "cita con Marta");
  assert.match(out, /marque como resuelto/);
});

test("completar_recordatorio: si no encuentra nada, no inventa exito", async (t) => {
  t.mock.method(command, "completarRecordatorio", async () => null);
  const out = await executeCommandTool("completar_recordatorio", { referencia: "algo que no existe" }, { scope: asesorScope(), session: null });
  assert.match(out, /No encontre ningun recordatorio pendiente/);
});
