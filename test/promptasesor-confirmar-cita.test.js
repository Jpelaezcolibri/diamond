const { test } = require("node:test");
const assert = require("node:assert");

const { buildSystemPrompt } = require("../src/agent/prompts");

const ORG = { id: "org-1", name: "Diamond Inmobiliaria" };
const ADVISOR = { name: "Natalia Perez" };

test("promptAsesor menciona confirmar_cita y OK CONFIRMADA", () => {
  const bloques = buildSystemPrompt({ org: ORG, advisor: ADVISOR, now: null });
  const texto = bloques.map((b) => b.text).join("\n");
  assert.match(texto, /confirmar_cita/);
  assert.match(texto, /OK CONFIRMADA/);
});

// Caso Catherine (2026-11-06): le escribio "Hola" a Sofi dos veces con una
// visita por confirmar encima y Sofi no se la menciono.
const CITA = {
  id: "l1", nombre: "Nancy David", phone: "573504465852", source: "colega",
  cita: { estado: "propuesta", ref: "10031500", fecha_hora: "2026-11-07T15:00:00Z", corte_at: "2026-11-07T13:00:00Z" },
};

test("promptAsesor le muestra al asesor sus visitas por confirmar, con el plazo", () => {
  const bloques = buildSystemPrompt({ org: ORG, advisor: ADVISOR, now: null, citasPendientes: [CITA] });
  const volatil = bloques[bloques.length - 1].text;
  assert.match(volatil, /VISITAS POR CONFIRMAR/);
  assert.match(volatil, /Nancy David \(colega\)/);
  assert.match(volatil, /Ref 10031500/);
  assert.match(volatil, /sábado, 7 de noviembre, 10:00 a\. m\./);
  assert.match(volatil, /antes de .*8:00 a\. m\./, "el plazo");
  assert.match(volatil, /OK CONFIRMADA/);
  assert.doesNotMatch(bloques[0].text, /Nancy/, "el dato va en el bloque volatil, no en el cacheado");
});

test("sin visitas pendientes, el bloque no existe", () => {
  const bloques = buildSystemPrompt({ org: ORG, advisor: ADVISOR, now: null, citasPendientes: [] });
  assert.doesNotMatch(bloques[bloques.length - 1].text, /VISITAS POR CONFIRMAR/);
});
