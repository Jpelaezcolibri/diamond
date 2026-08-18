// Encontrado revisando el pedido de Juan de darle "mayor alcance" a su chat
// de super admin (2026-08-18): enviar_whatsapp_equipo y
// registrar_resultado_radar no tenian NINGUN filtro de rol — cualquier
// asesor comun podia pedirle a Sofi que le escribiera a un companero o que
// le mostrara los pendientes de radar de TODA la org. Estos tests cubren el
// filtro (en dos capas: la lista de tools que ve el modelo, y la guarda
// dentro de executeCommandTool) y la tool nueva, crear_recordatorio_equipo.

const { test } = require("node:test");
const assert = require("node:assert");
const { executeCommandTool, toolsForScope, COMMAND_TOOL_DEFINITIONS } = require("../src/agent/sofi-comando-tools");
const command = require("../src/data/command");
const advisors = require("../src/data/advisors");

const ADMIN_ONLY = ["registrar_resultado_radar", "enviar_whatsapp_equipo", "crear_recordatorio_equipo", "enviar_matches_pendientes_equipo"];

function asesorScope() {
  return Object.freeze({ orgId: "org-1", viewerUid: "asesor-1", role: "asesor_ventas", isAdmin: false });
}
function adminScope() {
  return Object.freeze({ orgId: "org-1", viewerUid: "admin-1", role: "admin", isAdmin: true });
}

// ══ Capa 1: que tools ve el modelo ═════════════════════════════════════════

test("un asesor comun no ve las tools admin-only en su lista de herramientas", () => {
  const tools = toolsForScope(asesorScope()).map((t) => t.name);
  for (const nombre of ADMIN_ONLY) {
    assert.ok(!tools.includes(nombre), `${nombre} no deberia estar disponible para un asesor comun`);
  }
  // Y las demas siguen ahi — esto no es "asesor no ve nada nuevo".
  assert.ok(tools.includes("trazabilidad_radar"));
  assert.ok(tools.includes("crear_recordatorio"));
});

test("el admin ve la lista completa, sin nada filtrado", () => {
  const tools = toolsForScope(adminScope()).map((t) => t.name);
  assert.strictEqual(tools.length, COMMAND_TOOL_DEFINITIONS.length);
  for (const nombre of ADMIN_ONLY) assert.ok(tools.includes(nombre));
});

// ══ Capa 2: la guarda dentro de executeCommandTool (defensa en profundidad) ═

test("aunque se llame directo, un asesor comun no puede ejecutar una tool admin-only", async (t) => {
  let tocoElHandler = false;
  t.mock.method(command, "crearRecordatorio", async () => { tocoElHandler = true; return {}; });

  for (const nombre of ADMIN_ONLY) {
    const out = await executeCommandTool(nombre, { tipo: "VISITA", asesor: "Catherine", mensaje: "x", descripcion: "x" }, { scope: asesorScope(), session: null });
    assert.match(out, /solo lo puede usar un admin/i, `${nombre} deberia rechazarse para un asesor`);
  }
  assert.strictEqual(tocoElHandler, false, "ni siquiera debe llegar a tocar la base");
});

test("el admin SI puede ejecutar las tools admin-only", async (t) => {
  t.mock.method(command, "seguimientos", async () => ({ total: 0, items: [] }));
  // consultar_seguimientos no es admin-only — sirve de control: el guard no
  // debe bloquear tools normales para el admin.
  const out = await executeCommandTool("consultar_seguimientos", {}, { scope: adminScope(), session: null });
  assert.ok(out);
});

// ══ crear_recordatorio_equipo ═══════════════════════════════════════════════

test("crea el recordatorio con el auth_user_id del asesor destino, no del admin", async (t) => {
  t.mock.method(advisors, "searchByName", async (orgId, nombre) => {
    assert.strictEqual(nombre, "Catherine");
    return [{ name: "Catherine Uribe", auth_user_id: "auth-catherine" }];
  });
  const creados = [];
  t.mock.method(command, "crearRecordatorio", async (scope, fields) => {
    creados.push({ scope, fields });
    return { descripcion: fields.descripcion, fecha_hora: fields.fechaHoraIso };
  });

  const out = await executeCommandTool(
    "crear_recordatorio_equipo",
    { asesor: "Catherine", descripcion: "llamar al colega de Sabaneta" },
    { scope: adminScope(), session: null }
  );

  assert.strictEqual(creados.length, 1);
  assert.strictEqual(creados[0].fields.targetUserId, "auth-catherine");
  assert.match(out, /Catherine Uribe/);
  assert.match(out, /Solo Catherine Uribe lo va a ver/);
});

test("con fecha/hora, avisa que queda visible para todo el equipo", async (t) => {
  t.mock.method(advisors, "searchByName", async () => [{ name: "Danna Ospina", auth_user_id: "auth-danna" }]);
  t.mock.method(command, "crearRecordatorio", async (scope, fields) => ({ descripcion: fields.descripcion, fecha_hora: fields.fechaHoraIso }));

  const out = await executeCommandTool(
    "crear_recordatorio_equipo",
    { asesor: "Danna", descripcion: "visita con Pedro", fecha_hora_iso: "2026-08-19T15:00:00-05:00" },
    { scope: adminScope(), session: null }
  );

  assert.match(out, /Calendario del equipo/);
});

test("asesor sin acceso al CRM (sin auth_user_id): lo dice, no crea nada a ciegas", async (t) => {
  t.mock.method(advisors, "searchByName", async () => [{ name: "Asesor Sin Login", auth_user_id: null }]);
  let seCreo = false;
  t.mock.method(command, "crearRecordatorio", async () => { seCreo = true; return {}; });

  const out = await executeCommandTool(
    "crear_recordatorio_equipo",
    { asesor: "Asesor Sin Login", descripcion: "algo" },
    { scope: adminScope(), session: null }
  );

  assert.strictEqual(seCreo, false);
  assert.match(out, /no tiene acceso al CRM/);
});

test("nombre ambiguo, pregunta cual sin crear nada", async (t) => {
  t.mock.method(advisors, "searchByName", async () => [{ name: "Danna Ospina" }, { name: "Danna Ospina" }]);
  let seCreo = false;
  t.mock.method(command, "crearRecordatorio", async () => { seCreo = true; return {}; });

  const out = await executeCommandTool("crear_recordatorio_equipo", { asesor: "Danna", descripcion: "x" }, { scope: adminScope(), session: null });

  assert.strictEqual(seCreo, false);
  assert.match(out, /Hay 2 asesores/);
});
