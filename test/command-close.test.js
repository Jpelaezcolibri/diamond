const { test } = require("node:test");
const assert = require("node:assert");
const { renderClose, buildTomorrowQueue, renderBriefing } = require("../src/agent/sofi-comando");

function sampleFollow() {
  return {
    total: 2,
    items: [
      { lead_id: "l1", nombre: "Marcela Ruiz", phone: "573001", estado: "transferido", score: 85, dias_inactivo: 3, cita_fecha: null, motivo: "sin_actividad" },
      { lead_id: "l2", nombre: "Carlos Mesa", phone: "573002", estado: "calificado", score: 78, dias_inactivo: 4, cita_fecha: null, motivo: "sin_actividad" },
    ],
  };
}

test("buildTomorrowQueue: extrae los pendientes con lo esencial", () => {
  const queue = buildTomorrowQueue(sampleFollow());
  assert.strictEqual(queue.length, 2);
  assert.deepStrictEqual(Object.keys(queue[0]).sort(), ["lead_id", "motivo", "nombre", "phone"]);
  assert.strictEqual(queue[0].nombre, "Marcela Ruiz");
});

test("renderClose: resume el dia y anuncia la siembra de manana", () => {
  const metrics = { nuevos: 3, por_estado: {}, por_fuente: {} };
  const follow = sampleFollow();
  const tomorrowQueue = buildTomorrowQueue(follow);
  const text = renderClose({ userName: "Carlos", metrics, follow, tomorrowQueue });

  assert.match(text, /Buen dia hoy, Carlos/);
  assert.match(text, /3 lead/);
  assert.match(text, /2 pendiente/);
  assert.match(text, /Marcela Ruiz/);
});

test("siembra: la cola de hoy alimenta el briefing de manana (EXP-006 -> EXP-001)", () => {
  const tomorrowQueue = buildTomorrowQueue(sampleFollow());
  const briefingManana = renderBriefing({
    userName: "Carlos",
    metrics: { nuevos: 0, por_estado: {}, por_fuente: {} },
    follow: { total: 0, items: [] },
    seed: tomorrowQueue,
  });
  assert.match(briefingManana, /Ayer quedaron 2 pendiente/);
});
