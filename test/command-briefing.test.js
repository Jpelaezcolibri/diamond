const { test } = require("node:test");
const assert = require("node:assert");
const { renderBriefing } = require("../src/agent/sofi-comando");

function sampleFollow() {
  return {
    total: 3,
    items: [
      { lead_id: "l1", nombre: "Marcela Ruiz", phone: "573001", estado: "transferido", score: 85, dias_inactivo: 0, cita_fecha: "2026-07-10T11:00:00-05:00", motivo: "cita" },
      { lead_id: "l2", nombre: "Carlos Mesa", phone: "573002", estado: "calificado", score: 78, dias_inactivo: 4, cita_fecha: null, motivo: "sin_actividad" },
      { lead_id: "l3", nombre: "Ana Lopez", phone: "573003", estado: "calificado", score: 45, dias_inactivo: 6, cita_fecha: null, motivo: "sin_actividad" },
    ],
  };
}

test("renderBriefing: incluye numeros reales y ordena cita antes que leads nuevos", () => {
  const metrics = { nuevos: 4, por_estado: { nuevo: 4 }, por_fuente: { instagram: 3, landing: 1 } };
  const text = renderBriefing({ userName: "Carlos", metrics, follow: sampleFollow(), seed: null });

  assert.match(text, /Buenos dias, Carlos/);
  assert.match(text, /Marcela Ruiz/);          // la cita
  assert.match(text, /11:00/);                  // hora de la cita en Bogota
  assert.match(text, /caliente/);               // el lead score>=70 sin actividad
  assert.match(text, /Carlos Mesa/);
  assert.match(text, /4 lead/);                 // nuevos
  assert.match(text, /instagram/);              // fuente

  // La cita se menciona antes que los leads nuevos.
  assert.ok(text.indexOf("Marcela") < text.indexOf("lead(s) nuevo"), "la cita va antes que los nuevos");
});

test("renderBriefing: cuando hay siembra de ayer, la menciona primero", () => {
  const metrics = { nuevos: 0, por_estado: {}, por_fuente: {} };
  const seed = [{ lead_id: "l9", nombre: "Pedro Diaz", phone: "573009", motivo: "sin_actividad" }];
  const text = renderBriefing({ userName: "Carlos", metrics, follow: { total: 0, items: [] }, seed });

  assert.match(text, /Ayer quedaron 1 pendiente/);
  assert.match(text, /Pedro Diaz/);
});

test("renderBriefing: dia sin nada urgente no inventa datos", () => {
  const text = renderBriefing({ userName: null, metrics: { nuevos: 0, por_estado: {}, por_fuente: {} }, follow: { total: 0, items: [] }, seed: null });
  assert.match(text, /no tienes pendientes urgentes/i);
});
