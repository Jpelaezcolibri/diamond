// Validacion de agenda al agendar_cita. Mismo criterio de mock que
// ally-tool.test.js: advisors/appointments/leads tocan Supabase real, se
// mockean sus metodos desde el consumidor (tools.js ve el mock por require).
const { test } = require("node:test");
const assert = require("node:assert");
const { executeTool, TOOL_DEFINITIONS } = require("../src/agent/tools");
const { buildSystemPrompt } = require("../src/agent/prompts");
const advisors = require("../src/data/advisors");
const appointments = require("../src/data/appointments");
const leads = require("../src/data/leads");

const ORG = { id: "org-1", name: "Diamond" };

// REGLA DE JUAN (2026-09-11): "siempre las citas van al numero de Daiana que
// tiene la ventana abierta". La cita va a quien coordina las visitas
// (advisors.findAsesorPrincipalRadar, RADAR_REVISOR_PHONE), nunca a la
// rotacion de transferencias. Caso real: la visita de un cliente cayo en la
// rotacion, le llego a una asesora con la ventana cerrada hacia 142 h y se
// perdio sin que nadie se enterara.
const COORDINA = { id: "adv-daiana", name: "Daiana Zea", phone: "573011880668", auth_user_id: "uid-daiana", horario: null };
const ROTACION = { id: "adv-cathe", name: "Catherine Uribe", phone: "573028536489", auth_user_id: "uid-cathe", horario: null };

function mockCoordina(t) {
  t.mock.method(advisors, "findAsesorPrincipalRadar", async () => COORDINA);
  t.mock.method(advisors, "findForTransfer", async () => ROTACION);
}

function baseCtx() {
  return {
    org: ORG,
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

// CONFIRMACION DE VISITAS (2026-09-11): la cita nace `propuesta`, nadie de
// la casa la reviso todavia. Bug real: una visita se auto-confirmo y quedo
// en manos de un asesor que nunca la vio. Ver docs/superpowers/specs/2026-09-10-confirmacion-de-visitas-design.md.
test("agendar_cita: la cita nace propuesta, nunca confirmada de una", async (t) => {
  mockCoordina(t);
  t.mock.method(appointments, "checkAvailability", async () => ({ disponible: true }));
  t.mock.method(leads, "update", async (id, fields) => ({ id, ...fields }));

  const ctx = baseCtx();
  const r = await executeTool("agendar_cita", { fecha_hora_iso: "2026-09-12T15:00:00-05:00", tipo: "visita", descripcion: "ver la casa" }, ctx);

  assert.strictEqual(ctx.cita.estado, "propuesta");
  assert.doesNotMatch(r, /confirmad/i);
  assert.match(r, /solicitad/i);
});

test("agendar_cita: a un colega tambien le queda propuesta, y el texto de retorno menciona al coordinador para confirmar directo", async (t) => {
  t.mock.method(advisors, "findAsesorPrincipalRadar", async () => ({ name: "Daiana Zea", phone: "573011880668" }));
  t.mock.method(appointments, "checkAvailability", async () => ({ disponible: true }));
  t.mock.method(leads, "update", async (id, fields) => ({ id, ...fields }));

  const ctx = baseCtx();
  ctx.colega = { lid: "123@lid", telefono: "573112223344", nombre: "Esteban Higuita" };
  ctx.lead = { id: "lead-colega", phone: "573112223344", nombre: null, estado: "en_conversacion", score: 0, source: "colega" };
  ctx.propertyInteres = null;

  const r = await executeTool("agendar_cita", { fecha_hora_iso: "2026-09-12T15:00:00-05:00", tipo: "visita", descripcion: "ver la casa" }, ctx);

  assert.strictEqual(ctx.cita.estado, "propuesta");
  assert.match(r, /Daiana Zea/);
  assert.match(r, /573011880668/);
});

test("la cita de un CLIENTE va a quien coordina las visitas, nunca a la rotacion de transferencias", async (t) => {
  mockCoordina(t);
  t.mock.method(appointments, "checkAvailability", async () => ({ disponible: true }));
  t.mock.method(leads, "update", async (id, fields) => ({ id, ...fields }));

  const ctx = baseCtx();
  await executeTool("agendar_cita", { descripcion: "manana a las 3", fecha_hora_iso: "2026-09-12T15:00:00-05:00", tipo: "visita" }, ctx);

  assert.ok(ctx.appointmentAlert, "debe preparar el aviso inmediato");
  assert.strictEqual(ctx.appointmentAlert.advisorPhone, COORDINA.phone);
  assert.notStrictEqual(ctx.appointmentAlert.advisorPhone, ROTACION.phone, "la rotacion no recibe citas");
  assert.strictEqual(ctx.appointmentAlert.advisorName, COORDINA.name, "la entrega necesita saber de quien era el aviso");
  assert.strictEqual(ctx.appointmentAlert.advisorId, COORDINA.id);
  assert.strictEqual(ctx.cita.advisor_id, COORDINA.auth_user_id, "queda en SU agenda: contra esa se valida el choque");
});

test("agendar_cita con hora libre: estampa advisor_id, agenda y prepara aviso inmediato", async (t) => {
  mockCoordina(t);
  t.mock.method(appointments, "checkAvailability", async () => ({ disponible: true }));
  t.mock.method(leads, "update", async (id, fields) => ({ id, ...fields }));

  const ctx = baseCtx();
  const out = await executeTool("agendar_cita", { descripcion: "manana a las 3", fecha_hora_iso: "2026-07-24T15:00:00-05:00", tipo: "visita" }, ctx);

  assert.strictEqual(ctx.cita.advisor_id, "uid-daiana");
  assert.ok(ctx.appointmentAlert, "debe preparar el aviso inmediato");
  assert.strictEqual(ctx.appointmentAlert.advisorPhone, "573011880668");
  assert.match(ctx.appointmentAlert.advisorAlert, /Marta/);
  assert.match(out, /Cita registrada/);
  assert.match(out, /notificado/);
});

test("agendar_cita con choque: NO persiste la cita y pide otro horario", async (t) => {
  mockCoordina(t);
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
  mockCoordina(t);
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

// ── Sofi no escoge la hora sola (Juan, 2026-09-11) ─────────────────────────
// "sofi solo hace una previa pero la cita tiene que ir al asesor para validar
// disponibilidad". proximo_disponible (2026-08-21) hacia lo contrario: el
// sistema tomaba el primer espacio libre y Sofi se lo confirmaba al cliente.

test("proximo_disponible ya no existe: no busca espacio, no agenda y le pide a Sofi preguntar dia y hora", async (t) => {
  mockCoordina(t);
  let buscado = false;
  t.mock.method(appointments, "proximoDisponible", async () => {
    buscado = true;
    return "2026-07-24T15:00:00-05:00";
  });
  const updateCalls = [];
  t.mock.method(leads, "update", async (id, fields) => { updateCalls.push(fields); return { id, ...fields }; });

  const ctx = baseCtx();
  const out = await executeTool("agendar_cita", { descripcion: "quiere verla ya", proximo_disponible: true, tipo: "visita" }, ctx);

  assert.strictEqual(buscado, false, "el sistema no toma un espacio por su cuenta");
  assert.strictEqual(updateCalls.length, 0, "no se persiste nada");
  assert.strictEqual(ctx.cita, null);
  assert.strictEqual(ctx.appointmentAlert, null);
  assert.match(out, /pregunt/i, "Sofi le pregunta al cliente que dia y hora le sirven");
});

test("la tool agendar_cita ya no ofrece proximo_disponible ni le pide a Sofi confirmar", () => {
  const tool = TOOL_DEFINITIONS.find((x) => x.name === "agendar_cita");
  assert.strictEqual(tool.input_schema.properties.proximo_disponible, undefined);
  const textos = [tool.description, ...Object.values(tool.input_schema.properties).map((p) => p.description || "")].join("\n");
  assert.doesNotMatch(textos, /proximo_disponible/);
  assert.doesNotMatch(textos, /se lo confirmas|confirmale/i);
});

// Guarda contra la contradiccion que ya paso con revalidar.js (auditoria
// 2026-09-05): el texto de retorno de la tool decia "SOLICITADA" y el prompt
// seguia ordenando "listo, agendado para manana a las 8 am". Gana el prompt.
test("el prompt ya no le ordena a Sofi dar la cita por hecha ni escoger la hora sola", () => {
  const base = { org: ORG, lead: { id: "l1", estado: "nuevo" }, qualified: false, now: null };
  const cliente = buildSystemPrompt(base).map((b) => b.text).join("\n");
  const colega = buildSystemPrompt({
    ...base,
    colega: { nombre: "Esteban Higuita" },
    coordinador: { nombre: "Daiana Zea", telefono: "573011880668" },
  }).map((b) => b.text).join("\n");

  for (const [quien, p] of [["cliente", cliente], ["colega", colega]]) {
    assert.doesNotMatch(p, /agendado para/i, `${quien}: "listo, agendado" da la cita por hecha`);
    assert.doesNotMatch(p, /Al confirmar la cita/i, quien);
    assert.doesNotMatch(p, /confirmes una visita/i, quien);
    assert.doesNotMatch(p, /Al confirmarle/i, quien);
    assert.doesNotMatch(p, /proximo_disponible/, quien);
  }
});
