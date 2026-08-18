// Dos capacidades nuevas del Centro de Comando, pedidas por Juan el
// 2026-08-18 mientras validaba el fix del aviso del radar:
//
//   1. registrar_resultado_radar (version admin): que el ADMIN pueda cerrar
//      el ciclo de un pedido del radar sin depender del telefono de la
//      asesora — a diferencia de la version de Sofi-Cliente (src/agent/tools.js),
//      aca no hay un asesor escribiendo desde su propio numero, asi que los
//      pendientes se consultan de TODA la org, no de uno solo.
//   2. enviar_whatsapp_equipo: que Sofi pueda mandar un WhatsApp real a
//      alguien del equipo (antes solo podia sugerir que Juan lo hiciera).
//      La unica compuerta es la ventana de 24h que ya impone WhatsApp.

const { test } = require("node:test");
const assert = require("node:assert");
const { executeCommandTool, COMMAND_TOOL_DEFINITIONS } = require("../src/agent/sofi-comando-tools");
const groupSignals = require("../src/data/group-signals");
const signalEvents = require("../src/data/signal-events");
const advisors = require("../src/data/advisors");
const organizations = require("../src/data/organizations");
const mensajeAsesor = require("../src/lib/mensaje-asesor");

function adminScope() {
  return Object.freeze({ orgId: "org-1", viewerUid: "admin-1", role: "admin", isAdmin: true });
}

// ══ registrar_resultado_radar (admin) ═════════════════════════════════════

test("las dos tools estan declaradas", () => {
  const nombres = COMMAND_TOOL_DEFINITIONS.map((t) => t.name);
  assert.ok(nombres.includes("registrar_resultado_radar"));
  assert.ok(nombres.includes("enviar_whatsapp_equipo"));
});

test("sin pendientes en toda la org, lo dice", async (t) => {
  t.mock.method(groupSignals, "pendientesDeAviso", async (orgId, advisorId) => {
    assert.strictEqual(orgId, "org-1");
    assert.strictEqual(advisorId, null, "el admin consulta TODA la org, no un asesor puntual");
    return [];
  });

  const out = await executeCommandTool("registrar_resultado_radar", { tipo: "VISITA" }, { scope: adminScope(), session: null });

  assert.match(out, /No encuentro ningun pedido/);
});

test("un solo pendiente en toda la org: lo resuelve y registra advisorId=null", async (t) => {
  t.mock.method(groupSignals, "pendientesDeAviso", async () => [
    { id: "sig-1", texto_original: "busco apto en Sabaneta", aviso_advisor_id: "adv-catherine" },
  ]);
  t.mock.method(signalEvents, "ultimoPorSenal", async () => new Map());
  const registrados = [];
  t.mock.method(signalEvents, "registrar", async (orgId, fields) => { registrados.push(fields); });

  const out = await executeCommandTool("registrar_resultado_radar", { tipo: "CIERRE", motivo: "compro" }, { scope: adminScope(), session: null });

  assert.strictEqual(registrados.length, 1);
  assert.strictEqual(registrados[0].signalId, "sig-1");
  assert.strictEqual(registrados[0].advisorId, null, "quien registra (el admin) no es quien recibio el aviso");
  assert.strictEqual(registrados[0].tipo, "CIERRE");
  assert.match(out, /Listo/);
});

test("varios pendientes de VARIOS asesores: los lista con quien los recibio", async (t) => {
  t.mock.method(groupSignals, "pendientesDeAviso", async () => [
    { id: "sig-a", texto_original: "busco apto en Sabaneta", aviso_advisor_id: "adv-catherine" },
    { id: "sig-b", texto_original: "busco casa en Envigado", aviso_advisor_id: "adv-natalia" },
  ]);
  t.mock.method(signalEvents, "ultimoPorSenal", async () => new Map());
  t.mock.method(advisors, "findById", async (orgId, id) => ({
    id, name: id === "adv-catherine" ? "Catherine Uribe" : "Natalia Velez",
  }));
  let seRegistro = false;
  t.mock.method(signalEvents, "registrar", async () => { seRegistro = true; });

  const out = await executeCommandTool("registrar_resultado_radar", { tipo: "VISITA" }, { scope: adminScope(), session: null });

  assert.strictEqual(seRegistro, false);
  assert.match(out, /Hay 2 pedidos/);
  assert.match(out, /avisado a Catherine Uribe/);
  assert.match(out, /avisado a Natalia Velez/);
});

test("con 'cual' se puede desambiguar por el nombre del destinatario", async (t) => {
  t.mock.method(groupSignals, "pendientesDeAviso", async () => [
    { id: "sig-a", texto_original: "busco apto en Sabaneta", aviso_advisor_id: "adv-catherine" },
    { id: "sig-b", texto_original: "busco casa en Envigado", aviso_advisor_id: "adv-natalia" },
  ]);
  t.mock.method(signalEvents, "ultimoPorSenal", async () => new Map());
  t.mock.method(advisors, "findById", async (orgId, id) => ({
    id, name: id === "adv-catherine" ? "Catherine Uribe" : "Natalia Velez",
  }));
  const registrados = [];
  t.mock.method(signalEvents, "registrar", async (orgId, fields) => { registrados.push(fields); });

  const out = await executeCommandTool(
    "registrar_resultado_radar",
    { tipo: "SIN_RESPUESTA", cual: "natalia" },
    { scope: adminScope(), session: null }
  );

  assert.strictEqual(registrados.length, 1);
  assert.strictEqual(registrados[0].signalId, "sig-b");
  assert.match(out, /Listo/);
});

// ══ enviar_whatsapp_equipo ═════════════════════════════════════════════════

test("sin nombre o sin mensaje, no intenta mandar nada", async (t) => {
  let intentos = 0;
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async () => { intentos++; return { ok: true }; });

  await executeCommandTool("enviar_whatsapp_equipo", { asesor: "", mensaje: "hola" }, { scope: adminScope(), session: null });
  await executeCommandTool("enviar_whatsapp_equipo", { asesor: "Catherine", mensaje: "" }, { scope: adminScope(), session: null });

  assert.strictEqual(intentos, 0);
});

test("asesor inexistente, lo dice sin inventar", async (t) => {
  t.mock.method(advisors, "searchByName", async () => []);
  const out = await executeCommandTool("enviar_whatsapp_equipo", { asesor: "Nadie", mensaje: "hola" }, { scope: adminScope(), session: null });
  assert.match(out, /No encuentro ningun asesor/);
});

test("nombre ambiguo (varios matches), pregunta cual sin mandar nada", async (t) => {
  t.mock.method(advisors, "searchByName", async () => [{ name: "Danna Ospina" }, { name: "Danna Ospina" }]);
  let enviado = false;
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async () => { enviado = true; return { ok: true }; });

  const out = await executeCommandTool("enviar_whatsapp_equipo", { asesor: "Danna", mensaje: "hola" }, { scope: adminScope(), session: null });

  assert.strictEqual(enviado, false);
  assert.match(out, /Hay 2 asesores/);
});

test("envio exitoso: manda el texto exacto al telefono del asesor", async (t) => {
  t.mock.method(advisors, "searchByName", async () => [{ name: "Catherine Uribe", phone: "573028536489" }]);
  t.mock.method(organizations, "findById", async (orgId) => ({ id: orgId, name: "Diamond" }));
  let enviado = null;
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async (org, to, texto) => {
    enviado = { org, to, texto };
    return { ok: true, wamid: "w1" };
  });

  const out = await executeCommandTool(
    "enviar_whatsapp_equipo",
    { asesor: "Catherine", mensaje: "Te reenvio el pedido de Sabaneta" },
    { scope: adminScope(), session: null }
  );

  assert.strictEqual(enviado.to, "573028536489");
  assert.strictEqual(enviado.texto, "Te reenvio el pedido de Sabaneta");
  assert.match(out, /Listo/);
});

test("ventana de 24h cerrada: dice que no se pudo, no finge que salio", async (t) => {
  t.mock.method(advisors, "searchByName", async () => [{ name: "Catherine Uribe", phone: "573028536489" }]);
  t.mock.method(organizations, "findById", async (orgId) => ({ id: orgId, name: "Diamond" }));
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async () => ({ ok: false, error: "ventana cerrada" }));

  const out = await executeCommandTool(
    "enviar_whatsapp_equipo",
    { asesor: "Catherine", mensaje: "hola" },
    { scope: adminScope(), session: null }
  );

  assert.match(out, /No se pudo enviar/);
  assert.match(out, /24 horas/);
});

test("asesor sin telefono cargado, lo dice", async (t) => {
  t.mock.method(advisors, "searchByName", async () => [{ name: "Sin Telefono", phone: null }]);
  const out = await executeCommandTool("enviar_whatsapp_equipo", { asesor: "Sin Telefono", mensaje: "hola" }, { scope: adminScope(), session: null });
  assert.match(out, /no tiene telefono/);
});
