// Atencion bilingue: link cliente→asesor en ingles, alertas al asesor SIEMPRE
// en español con la linea "Idioma: INGLÉS", y follow-up en ingles.
const { test } = require("node:test");
const assert = require("node:assert");
const {
  buildClientLink,
  buildAdvisorAlert,
  buildAppointmentAlert,
  buildCaptadorInterestAlert,
} = require("../src/notifications/advisor");
const { buildFollowupSystemPrompt } = require("../src/scheduler/followups");
const { buildSystemPrompt } = require("../src/agent/prompts");

const ADVISOR = { name: "Natalia", phone: "573009998877", especialidad: "venta" };
const ORG = { name: "Diamond" };

function leadEn(extra = {}) {
  return { phone: "13055550123", nombre: "John", idioma: "en", score: 60, ...extra };
}

test("buildClientLink en ingles: interes en propiedad", () => {
  const url = buildClientLink(ADVISOR, leadEn({ property_ref_origen: "9702941" }), null, null);
  const texto = decodeURIComponent(url.split("text=")[1]);
  assert.match(texto, /^Hi, I'm John\. I'm interested in this property: 9702941$/);
});

test("buildClientLink en ingles: confirmacion de cita", () => {
  const cita = { tipo: "visita", fecha_hora: "2026-07-25T15:00:00-05:00", descripcion: "mañana 3pm" };
  const url = buildClientLink(ADVISOR, leadEn(), null, cita);
  const texto = decodeURIComponent(url.split("text=")[1]);
  assert.match(texto, /I want to confirm the visit on/);
});

test("buildClientLink español intacto sin idioma", () => {
  const url = buildClientLink(ADVISOR, { phone: "573001", nombre: "Ana", property_ref_origen: "111" }, null, null);
  const texto = decodeURIComponent(url.split("text=")[1]);
  assert.match(texto, /^Hola, soy Ana\. estoy interesado en esta propiedad: 111$/);
});

test("alerta de transferencia: en español y con linea de idioma para lead EN", () => {
  const alert = buildAdvisorAlert(ORG, leadEn({ score: 80 }), "calificado", null, "venta", null, null);
  assert.match(alert, /Nuevo lead Diamond/);
  assert.match(alert, /Idioma: INGLÉS/);
});

test("alerta de transferencia: sin linea de idioma para lead español", () => {
  const alert = buildAdvisorAlert(ORG, { phone: "573001", score: 50 }, "motivo", null, "venta", null, null);
  assert.doesNotMatch(alert, /Idioma:/);
});

test("alerta de cita y de captador llevan la linea de idioma para lead EN", () => {
  const cita = { tipo: "visita", fecha_hora: "2026-07-25T15:00:00-05:00" };
  assert.match(buildAppointmentAlert(ADVISOR, leadEn(), cita), /Idioma: INGLÉS/);
  const prop = { ref: "9702941", titulo: "Apto en Laureles", zona: "Laureles" };
  assert.match(buildCaptadorInterestAlert(prop, leadEn()), /Idioma: INGLÉS/);
});

test("followup: prompt exige ingles para lead EN y no para español", () => {
  assert.match(buildFollowupSystemPrompt(ORG, leadEn()), /completamente en ingles/);
  assert.doesNotMatch(buildFollowupSystemPrompt(ORG, { idioma: null }), /ingles/);
});

test("prompt de Sofi: bloque de idioma solo para lead EN", () => {
  const blocks = buildSystemPrompt({ org: { name: "Diamond" }, lead: leadEn(), qualified: false, now: null });
  const volatil = blocks[1].text;
  assert.match(volatil, /IDIOMA DEL CLIENTE: INGLÉS/);
  const blocksEs = buildSystemPrompt({ org: { name: "Diamond" }, lead: { phone: "573001" }, qualified: false, now: null });
  assert.doesNotMatch(blocksEs[1].text, /IDIOMA DEL CLIENTE/);
});
