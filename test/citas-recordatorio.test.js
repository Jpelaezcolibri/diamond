const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");

const citasRecordatorio = require("../src/scheduler/citas-recordatorio");
const config = require("../src/config");
const organizations = require("../src/data/organizations");
const advisors = require("../src/data/advisors");
const leads = require("../src/data/leads");
const mensajeAsesor = require("../src/lib/mensaje-asesor");

const ORG = { id: "org-1", name: "Diamond" };
const ADVISOR = { id: "adv-catherine", auth_user_id: "adv-catherine", name: "Catherine Uribe", phone: "573028536489" };

let originalConfig;
beforeEach(() => {
  originalConfig = { ...config.citasRecordatorio };
  config.citasRecordatorio.enabled = true;
  config.citasRecordatorio.silenceMin = 120;
});
afterEach(() => Object.assign(config.citasRecordatorio, originalConfig));

test("una cita propuesta hace mas de 2h sin confirmar dispara un recordatorio, una sola vez", async (t) => {
  t.mock.method(organizations, "listActive", async () => [ORG]);
  // Resuelve la org REAL de la cita (no un objeto sintetico {id}): ver la nota
  // en src/scheduler/citas-recordatorio.js sobre por que enviarYRegistrar ->
  // sendWhatsApp necesita mas que el id (org.whatsapp_token / whatsapp_phone_id).
  t.mock.method(organizations, "findById", async () => ORG);
  const vencida = {
    id: "lead-1", org_id: ORG.id, nombre: "Sebastian", phone: "573009998888",
    cita: { estado: "propuesta", advisor_id: "adv-catherine", creada_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(), fecha_hora: "2026-09-12T15:00:00-05:00" },
  };
  t.mock.method(leads, "listConCitasPropuestasVencidas", async () => [vencida]);
  t.mock.method(advisors, "findByAuthUserId", async () => ADVISOR);
  const envios = [];
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async (org, phone, texto) => { envios.push({ phone, texto }); return { ok: true }; });
  const updates = [];
  t.mock.method(leads, "update", async (id, patch) => { updates.push({ id, patch }); return { ...vencida, ...patch }; });

  const r = await citasRecordatorio.runOnce();

  assert.strictEqual(r.sent, 1);
  assert.strictEqual(envios[0].phone, ADVISOR.phone);
  assert.match(envios[0].texto, /Sebastian/);
  assert.match(envios[0].texto, /OK CONFIRMADA/);
  assert.strictEqual(updates[0].patch.cita.recordatorio_confirmacion_enviado, true);
});

test("una cita ya recordada no se vuelve a recordar", async (t) => {
  t.mock.method(organizations, "listActive", async () => [ORG]);
  t.mock.method(leads, "listConCitasPropuestasVencidas", async () => []); // la consulta real ya la excluye
  const r = await citasRecordatorio.runOnce();
  assert.strictEqual(r.sent, 0);
});
