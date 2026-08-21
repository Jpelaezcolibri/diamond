// Validacion de agenda al agendar_cita. Mismo criterio de mock que
// ally-tool.test.js: advisors/appointments/leads tocan Supabase real, se
// mockean sus metodos desde el consumidor (tools.js ve el mock por require).
const { test } = require("node:test");
const assert = require("node:assert");
const { executeTool } = require("../src/agent/tools");
const advisors = require("../src/data/advisors");
const appointments = require("../src/data/appointments");
const leads = require("../src/data/leads");

function baseCtx() {
  return {
    org: { id: "org-1", name: "Diamond" },
    lead: { id: "lead-1", phone: "573001112233", nombre: "Marta", categoria: "compra", intencion: "comprar", estado: "en_conversacion", score: 0, property_ref_origen: "9702941" },
    propertyInteres: { ref: "9702941", operacion: "Venta" },
    transfer: null,
    cita: null,
    allyMatch: null,
    allyAlert: null,
    appointmentAlert: null,
    lastUserMessage: "quiero ver el apto manana a las 3",
  };
}

test("agendar_cita con hora libre: estampa advisor_id, agenda y prepara aviso inmediato", async (t) => {
  t.mock.method(advisors, "findForTransfer", async () => ({ name: "Camila", phone: "573009990000", auth_user_id: "uid-camila", horario: null }));
  t.mock.method(appointments, "checkAvailability", async () => ({ disponible: true }));
  t.mock.method(leads, "update", async (id, fields) => ({ id, ...fields }));

  const ctx = baseCtx();
  const out = await executeTool("agendar_cita", { descripcion: "manana a las 3", fecha_hora_iso: "2026-07-24T15:00:00-05:00", tipo: "visita" }, ctx);

  assert.strictEqual(ctx.cita.advisor_id, "uid-camila");
  assert.ok(ctx.appointmentAlert, "debe preparar el aviso inmediato");
  assert.strictEqual(ctx.appointmentAlert.advisorPhone, "573009990000");
  assert.match(ctx.appointmentAlert.advisorAlert, /Marta/);
  assert.match(out, /Cita registrada/);
  assert.match(out, /notificado/);
});

test("agendar_cita con choque: NO persiste la cita y pide otro horario", async (t) => {
  t.mock.method(advisors, "findForTransfer", async () => ({ name: "Camila", phone: "573009990000", auth_user_id: "uid-camila" }));
  t.mock.method(appointments, "checkAvailability", async () => ({ disponible: false, motivo: "choque" }));
  let updateCalls = 0;
  t.mock.method(leads, "update", async (id, fields) => { updateCalls++; return { id, ...fields }; });

  const ctx = baseCtx();
  const out = await executeTool("agendar_cita", { descripcion: "manana a las 3", fecha_hora_iso: "2026-07-24T15:00:00-05:00", tipo: "visita" }, ctx);

  assert.strictEqual(updateCalls, 0, "no debe persistir la cita en choque");
  assert.strictEqual(ctx.appointmentAlert, null);
  assert.match(out, /No se pudo agendar/);
  assert.match(out, /otro dia u hora/i);
});

test("agendar_cita fuera de horario: mensaje especifico, sin agendar", async (t) => {
  t.mock.method(advisors, "findForTransfer", async () => ({ name: "Camila", phone: "573009990000", auth_user_id: "uid-camila" }));
  t.mock.method(appointments, "checkAvailability", async () => ({ disponible: false, motivo: "fuera_de_horario" }));
  t.mock.method(leads, "update", async (id, fields) => ({ id, ...fields }));

  const ctx = baseCtx();
  const out = await executeTool("agendar_cita", { descripcion: "domingo temprano", fecha_hora_iso: "2026-07-26T07:00:00-05:00", tipo: "visita" }, ctx);

  assert.match(out, /fuera del horario de atencion/);
  assert.strictEqual(ctx.appointmentAlert, null);
});

test("agendar_cita sin fecha_hora: comportamiento viejo, no valida ni notifica", async (t) => {
  const availCalls = [];
  t.mock.method(appointments, "checkAvailability", async (...a) => { availCalls.push(a); return { disponible: true }; });
  t.mock.method(leads, "update", async (id, fields) => ({ id, ...fields }));

  const ctx = baseCtx();
  const out = await executeTool("agendar_cita", { descripcion: "la otra semana", tipo: "llamada" }, ctx);

  assert.strictEqual(availCalls.length, 0, "sin hora no valida agenda");
  assert.strictEqual(ctx.appointmentAlert, null);
  assert.match(out, /Cita registrada/);
  assert.match(out, /Cuando transfieras/);
});

// ── proximo_disponible (Juan, 2026-08-21) ──────────────────────────────────
// "todo lo que digan que cuando se puede ver inmediatamente se agenda...
// utilizalo y ocupa un espacio" — el cliente pregunta por ver la propiedad
// SIN proponer dia/hora; el sistema busca el primer espacio libre solo.

test("proximo_disponible: busca el espacio, lo agenda con origen=auto y prepara el aviso al asesor", async (t) => {
  t.mock.method(advisors, "findForTransfer", async () => ({ name: "Camila", phone: "573009990000", auth_user_id: "uid-camila", horario: null }));
  t.mock.method(appointments, "proximoDisponible", async (orgId, advisor) => {
    assert.strictEqual(advisor.auth_user_id, "uid-camila");
    return "2026-07-24T15:00:00-05:00";
  });
  t.mock.method(appointments, "checkAvailability", async (orgId, advisor, fechaHora) => {
    assert.strictEqual(fechaHora, "2026-07-24T15:00:00-05:00");
    return { disponible: true };
  });
  t.mock.method(leads, "update", async (id, fields) => ({ id, ...fields }));

  const ctx = baseCtx();
  const out = await executeTool("agendar_cita", { descripcion: "quiere verla lo antes posible", proximo_disponible: true, tipo: "visita" }, ctx);

  assert.strictEqual(ctx.cita.fecha_hora, "2026-07-24T15:00:00-05:00");
  assert.strictEqual(ctx.cita.origen, "auto");
  assert.strictEqual(ctx.cita.advisor_id, "uid-camila");
  assert.ok(ctx.appointmentAlert, "debe preparar el aviso al asesor, igual que una cita normal");
  assert.match(out, /Cita registrada/);
  assert.match(out, /EXACTAMENTE/);
});

test("proximo_disponible y fecha_hora_iso juntos: son excluyentes, no agenda nada", async (t) => {
  const updateCalls = [];
  t.mock.method(leads, "update", async (id, fields) => { updateCalls.push(fields); return { id, ...fields }; });

  const ctx = baseCtx();
  const out = await executeTool("agendar_cita", { descripcion: "x", proximo_disponible: true, fecha_hora_iso: "2026-07-24T15:00:00-05:00" }, ctx);

  assert.match(out, /excluyentes/);
  assert.strictEqual(updateCalls.length, 0);
  assert.strictEqual(ctx.cita, null);
});

test("proximo_disponible sin nada libre en el horizonte: pide que el cliente proponga dia/hora, no inventa nada", async (t) => {
  t.mock.method(advisors, "findForTransfer", async () => ({ name: "Camila", phone: "573009990000", auth_user_id: "uid-camila" }));
  t.mock.method(appointments, "proximoDisponible", async () => null);
  const updateCalls = [];
  t.mock.method(leads, "update", async (id, fields) => { updateCalls.push(fields); return { id, ...fields }; });

  const ctx = baseCtx();
  const out = await executeTool("agendar_cita", { descripcion: "quiere verla ya", proximo_disponible: true }, ctx);

  assert.match(out, /No encontre ningun espacio libre/);
  assert.match(out, /fecha_hora_iso/);
  assert.strictEqual(updateCalls.length, 0, "no debe persistir nada si no se encontro espacio");
  assert.strictEqual(ctx.cita, null);
});

test("proximo_disponible con carrera (el espacio se ocupo justo antes de confirmar): mensaje especifico, no le echa la culpa al cliente", async (t) => {
  t.mock.method(advisors, "findForTransfer", async () => ({ name: "Camila", phone: "573009990000", auth_user_id: "uid-camila" }));
  t.mock.method(appointments, "proximoDisponible", async () => "2026-07-24T15:00:00-05:00");
  t.mock.method(appointments, "checkAvailability", async () => ({ disponible: false, motivo: "choque" }));
  const updateCalls = [];
  t.mock.method(leads, "update", async (id, fields) => { updateCalls.push(fields); return { id, ...fields }; });

  const ctx = baseCtx();
  const out = await executeTool("agendar_cita", { descripcion: "quiere verla ya", proximo_disponible: true }, ctx);

  assert.match(out, /se ocupo justo antes de confirmar/);
  assert.doesNotMatch(out, /Ofrecele al cliente proponer OTRO dia/);
  assert.strictEqual(updateCalls.length, 0);
});

test("proximo_disponible sin poder resolver asesor: no rompe, pide fecha_hora_iso", async (t) => {
  t.mock.method(advisors, "findForTransfer", async () => null);

  const ctx = baseCtx();
  const out = await executeTool("agendar_cita", { descripcion: "quiere verla ya", proximo_disponible: true }, ctx);

  assert.match(out, /No pude resolver el asesor/);
});

// AUTO_AGENDA_ALERTA_TO se lee de RADAR_ALERTA_TO al cargar tools.js (mismo
// patron que test/group-dm.test.js con RADAR_VISITAS_ALERTA_TO): hay que
// setearlo ANTES del require y volver a requerir con cache limpio.
test("proximo_disponible: avisa a RADAR_ALERTA_TO ademas de notificar al asesor", async (t) => {
  const rutaTools = require.resolve("../src/agent/tools");
  const rutaMensajeAsesor = require.resolve("../src/lib/mensaje-asesor");
  const previo = process.env.RADAR_ALERTA_TO;
  process.env.RADAR_ALERTA_TO = "573016981200";
  delete require.cache[rutaTools];
  const { executeTool: executeToolConAlerta } = require("../src/agent/tools");
  process.env.RADAR_ALERTA_TO = previo;

  t.mock.method(advisors, "findForTransfer", async () => ({ name: "Camila", phone: "573009990000", auth_user_id: "uid-camila" }));
  t.mock.method(appointments, "proximoDisponible", async () => "2026-07-24T15:00:00-05:00");
  t.mock.method(appointments, "checkAvailability", async () => ({ disponible: true }));
  t.mock.method(leads, "update", async (id, fields) => ({ id, ...fields }));
  const mensajeAsesor = require("../src/lib/mensaje-asesor");
  let avisoJuan = null;
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async (org, telefono, texto) => {
    avisoJuan = { telefono, texto };
    return { ok: true, wamid: "w1" };
  });

  const ctx = baseCtx();
  await executeToolConAlerta("agendar_cita", { descripcion: "quiere verla ya", proximo_disponible: true }, ctx);
  // El aviso se dispara sin esperar (best-effort) — le doy una vuelta al
  // microtask queue para que el .catch()/then() encolado alcance a correr.
  await new Promise((r) => setImmediate(r));

  assert.ok(avisoJuan, "debe avisarle a Juan de la cita auto-agendada");
  assert.strictEqual(avisoJuan.telefono, "573016981200");
  assert.match(avisoJuan.texto, /auto-agendada/);

  delete require.cache[rutaTools];
  delete require.cache[rutaMensajeAsesor];
});
