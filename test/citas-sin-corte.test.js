// CITAS_SIN_CORTE (spec 2026-10-25 §6): en el plazo no se cancela, se avisa
// una vez "seguimos confirmando" y el corte pasa a 2 h antes de la visita.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const escalera = require("../src/scheduler/citas-escalera");
const { pasoDeEscalera } = escalera;

const H = { dias: [0, 1, 2, 3, 4, 5, 6], desde: "08:00", hasta: "18:00" };
const A1 = { id: "a1", org_id: "org-1", name: "Daiana", phone: "1", alias_publico: "Asesor 1", activo: true, recibe_citas: true, orden_citas: 1, horario: H };
const A2 = { id: "a2", org_id: "org-1", name: "Claudia", phone: "2", alias_publico: "Asesor 2", activo: true, recibe_citas: true, orden_citas: 2, horario: H };
// Visita viernes 2026-10-09 3:00 p. m. Bogota (20:00Z); corte 11:00 a. m. (16:00Z).
const cita = (over = {}) => ({ estado: "propuesta", fecha_hora: "2026-10-09T20:00:00Z", corte_at: "2026-10-09T16:00:00Z", creada_at: "2026-10-07T15:00:00Z", asignada_at: "2026-10-09T15:30:00Z", asesor_id: "a1", ref: "10013037", historial: [], ...over });
const lead = (over = {}) => ({ id: "l1", org_id: "org-1", nombre: "Andrea", phone: "573125550000", source: "colega", cita: cita(over) });

beforeEach(() => { process.env.CITAS_SIN_CORTE = "true"; });
afterEach(() => { delete process.env.CITAS_SIN_CORTE; });

test("apagado: en el corte se cancela como siempre", () => {
  delete process.env.CITAS_SIN_CORTE;
  assert.strictEqual(pasoDeEscalera({ lead: lead(), ciclo: [A1, A2], citasOrg: [], ahora: new Date("2026-10-09T16:00:00Z") }).accion, "cortar");
});

test("encendido: en el corte se extiende hasta 2 h antes de la visita", () => {
  const p = pasoDeEscalera({ lead: lead(), ciclo: [A1, A2], citasOrg: [], ahora: new Date("2026-10-09T16:00:00Z") });
  assert.deepStrictEqual(p, { accion: "extender", nuevoCorte: "2026-10-09T18:00:00.000Z" });
});

test("ya extendida: en el nuevo corte se cancela, aunque sea de noche", () => {
  const l = lead({ aviso_espera_at: "2026-10-09T16:00:00Z", corte_at: "2026-10-10T03:00:00Z", fecha_hora: "2026-10-10T05:00:00Z" });
  assert.strictEqual(pasoDeEscalera({ lead: l, ciclo: [A1, A2], citasOrg: [], ahora: new Date("2026-10-10T03:00:00Z") }).accion, "cortar");
});

test("si 2 h antes ya pasó cuando llega el corte, se cancela directo", () => {
  const l = lead({ corte_at: "2026-10-09T19:00:00Z" });
  assert.strictEqual(pasoDeEscalera({ lead: l, ciclo: [A1, A2], citasOrg: [], ahora: new Date("2026-10-09T19:00:00Z") }).accion, "cortar");
});

test("runOnce: extiende, avisa una sola vez al colega y no cancela", async () => {
  memory.leads.length = 0;
  memory.advisors.length = 0;
  memory.advisors.push({ ...A1 }, { ...A2 });
  const l = lead();
  memory.leads.push(l);
  const enviados = [];
  const deps = {
    aviso: async () => ({ ok: true }),
    texto: async (_o, to, t) => { enviados.push({ to, t }); return { ok: true }; },
    plantilla: async (_o, to, o) => { enviados.push({ to, plantilla: o.name }); return { ok: true }; },
    org: async () => ({ id: "org-1", name: "Diamond" }),
    notificar: async () => ({ ok: true }),
    reaviso: async () => ({ ok: true }),
    vencidas: async () => ({ vencidas: 0 }),
    soloLlamada: async () => false,
  };
  await escalera.runOnce({ ahora: new Date("2026-10-09T16:00:00Z"), deps });
  assert.strictEqual(memory.leads[0].cita.estado, "propuesta");
  assert.strictEqual(memory.leads[0].cita.corte_at, "2026-10-09T18:00:00.000Z");
  assert.strictEqual(memory.leads[0].cita.corte_original_at, "2026-10-09T16:00:00Z");
  assert.strictEqual(enviados.length, 1);
  assert.match(enviados[0].t, /^Seguimos confirmando tu visita del .+ con el asesor\. Te aviso apenas la confirme\.$/);
  assert.ok(!enviados.some((e) => e.plantilla));
  await escalera.runOnce({ ahora: new Date("2026-10-09T16:05:00Z"), deps });
  assert.strictEqual(enviados.length, 1, "el aviso de espera sale una sola vez");
});
