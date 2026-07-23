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
