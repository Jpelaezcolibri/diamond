const { test } = require("node:test");
const assert = require("node:assert");

const { executeTool } = require("../src/agent/tools");
const appointments = require("../src/data/appointments");
const leads = require("../src/data/leads");
const colegas = require("../src/data/colegas");
const canalWhatsapp = require("../src/channels/whatsapp");

const ORG = { id: "org-1", name: "Diamond" };
const ADVISOR = { name: "Catherine Uribe", phone: "573028536489", auth_user_id: "adv-catherine", alias_publico: "Asesor 3" };

function ctxAsesor() {
  return { org: ORG, advisor: ADVISOR, colega: null, lead: { id: "lead-asesor", phone: ADVISOR.phone } };
}

test("confirmar_cita: sin ctx.advisor, la rechaza", async () => {
  const r = await executeTool("confirmar_cita", {}, { org: ORG, advisor: null });
  assert.match(r, /solo.*asesor/i);
});

test("confirmar_cita: ninguna pendiente", async (t) => {
  t.mock.method(appointments, "citasPendientesDeConfirmar", async () => []);
  const r = await executeTool("confirmar_cita", {}, ctxAsesor());
  assert.match(r, /no tenes ninguna/i);
});

test("confirmar_cita: varias pendientes, pregunta cual", async (t) => {
  t.mock.method(appointments, "citasPendientesDeConfirmar", async () => [
    { id: "l1", nombre: "Sebastian", phone: "573001111111", source: "whatsapp", cita: { fecha_hora: "2026-09-12T15:00:00-05:00", tipo: "visita" } },
    { id: "l2", nombre: "Otro", phone: "573002222222", source: "whatsapp", cita: { fecha_hora: "2026-09-13T10:00:00-05:00", tipo: "visita" } },
  ]);
  const r = await executeTool("confirmar_cita", {}, ctxAsesor());
  assert.match(r, /2 citas/i);
  assert.match(r, /Sebastian/);
  assert.match(r, /Otro/);
});

test("confirmar_cita: una sola pendiente, la confirma y avisa al cliente por la linea oficial", async (t) => {
  const pendiente = { id: "lead-sebastian", nombre: "Sebastian Velasquez", phone: "573009998888", source: "whatsapp", cita: { fecha_hora: "2026-09-12T15:00:00-05:00", tipo: "visita", estado: "propuesta", ref: "9548121" } };
  t.mock.method(appointments, "citasPendientesDeConfirmar", async () => [pendiente]);
  t.mock.method(colegas, "esSoloLlamada", async () => false);
  const updates = [];
  t.mock.method(leads, "update", async (id, patch) => { updates.push({ id, patch }); return { ...pendiente, ...patch }; });
  const envios = [];
  t.mock.method(canalWhatsapp, "sendWhatsApp", async (org, phone, texto) => { envios.push({ phone, texto }); return { ok: true, wamid: "w1" }; });

  const r = await executeTool("confirmar_cita", {}, ctxAsesor());

  assert.strictEqual(updates[0].id, "lead-sebastian");
  assert.strictEqual(updates[0].patch.cita.estado, "confirmada");
  assert.ok(updates[0].patch.cita.confirmada_at);
  assert.strictEqual(updates[0].patch.cita.confirmada_por, "Catherine Uribe");
  assert.strictEqual(envios[0].phone, "573009998888");
  assert.match(envios[0].texto, /confirmada/i);
  assert.match(envios[0].texto, /Te recibe Asesor 3./);
  assert.doesNotMatch(envios[0].texto, /Catherine|573028536489/, "al cliente no va el nombre real ni el celular (2026-10-07)");
  assert.match(r, /confirmada/i);
  assert.match(r, /ya le avis/i);
});

test("confirmar_cita: colega marcado solo llamada -- no le escribe, se lo dice al asesor", async (t) => {
  const pendiente = { id: "lead-colega", nombre: "Un colega", phone: "573007776666", source: "colega", cita: { fecha_hora: "2026-09-12T15:00:00-05:00", tipo: "visita", estado: "propuesta" } };
  t.mock.method(appointments, "citasPendientesDeConfirmar", async () => [pendiente]);
  t.mock.method(colegas, "esSoloLlamada", async () => true);
  t.mock.method(leads, "update", async (id, patch) => ({ ...pendiente, ...patch }));
  const envios = [];
  t.mock.method(canalWhatsapp, "sendWhatsApp", async (org, phone, texto) => { envios.push({ phone, texto }); return { ok: true, wamid: "w1" }; });

  const r = await executeTool("confirmar_cita", {}, ctxAsesor());

  assert.strictEqual(envios.length, 0);
  assert.match(r, /no le pude avisar|avisale vos|solo llamada/i);
});

test("confirmar: ventana cerrada y SOFI_CITA_CONFIRMADA_PLANTILLA, sale la plantilla con 4 parametros", async (t) => {
  const { confirmar } = require("../src/lib/confirmar-cita");
  process.env.SOFI_CITA_CONFIRMADA_PLANTILLA = "cita_confirmada";
  t.after(() => delete process.env.SOFI_CITA_CONFIRMADA_PLANTILLA);
  t.mock.method(leads, "update", async () => ({}));
  const plantillas = [];
  const mk = () => ({
    org: ORG,
    advisor: ADVISOR,
    lead: { id: "l1", nombre: "Ana Pérez", phone: "573009998888", source: "whatsapp", cita: { fecha_hora: "2026-10-23T10:00:00-05:00", tipo: "visita", ref: "9548121" } },
  });
  const deps = {
    soloLlamada: async () => false,
    texto: async () => ({ ok: false, error: "Message undeliverable: more than 24 hours" }),
    plantilla: async (o, tel, p) => (plantillas.push(p), { ok: true }),
  };
  const r = await confirmar({ ...mk(), deps });
  assert.strictEqual(plantillas[0].name, "cita_confirmada");
  assert.strictEqual(plantillas[0].bodyParams.length, 4);
  assert.strictEqual(plantillas[0].bodyParams[0], "Ana");
  assert.match(plantillas[0].bodyParams[1], /viernes.*23 de octubre a las 10:00/);
  assert.strictEqual(plantillas[0].bodyParams[2], "9548121");
  assert.strictEqual(plantillas[0].bodyParams[3], "Asesor 3");
  assert.match(r.texto, /ya le avis/i);

  // sin ref: no se usa la plantilla y se le pide al asesor avisar
  plantillas.length = 0;
  const m = mk();
  m.lead.cita.ref = null;
  const r2 = await confirmar({ ...m, deps });
  assert.strictEqual(plantillas.length, 0);
  assert.match(r2.texto, /avisale vos/i);

  // la plantilla tambien falla: fallback de siempre
  const r3 = await confirmar({ ...mk(), deps: { ...deps, plantilla: async () => ({ ok: false, error: "x" }) } });
  assert.match(r3.texto, /avisale vos/i);
});
