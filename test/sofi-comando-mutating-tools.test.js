const { test } = require("node:test");
const assert = require("node:assert");
const { MUTATING_TOOLS, COMMAND_TOOL_DEFINITIONS } = require("../src/agent/sofi-comando-tools");

test("MUTATING_TOOLS contiene las herramientas que escriben o mandan mensajes", () => {
  for (const nombre of [
    "registrar_mandato_compra", "enviar_whatsapp_equipo", "crear_recordatorio_equipo",
    "registrar_resultado_radar", "aprobar_pedido_radar", "enviar_matches_pendientes_equipo",
    "cerrar_lead", "registrar_propiedad_colega", "marcar_propiedad",
    "marcar_prioridad_venta", "crear_recordatorio", "completar_recordatorio",
  ]) {
    assert.ok(MUTATING_TOOLS.has(nombre), `${nombre} deberia estar en MUTATING_TOOLS`);
  }
});

test("MUTATING_TOOLS NO contiene herramientas de solo lectura", () => {
  for (const nombre of [
    "consultar_seguimientos", "metricas_leads", "buscar_inventario",
    "resumen_lead", "trazabilidad_radar", "consultar_recordatorios",
  ]) {
    assert.ok(!MUTATING_TOOLS.has(nombre), `${nombre} es de solo lectura, no deberia estar en MUTATING_TOOLS`);
  }
});

test("cada nombre de MUTATING_TOOLS corresponde a una tool declarada de verdad", () => {
  const nombresDeclarados = new Set(COMMAND_TOOL_DEFINITIONS.map((t) => t.name));
  for (const nombre of MUTATING_TOOLS) {
    assert.ok(nombresDeclarados.has(nombre), `${nombre} esta en MUTATING_TOOLS pero no existe como tool declarada`);
  }
});
