// La escalera de una cita por confirmar (Juan, 2026-10-07): cada hora pasa al
// siguiente asesor del ciclo, hasta que alguien confirme; de noche se pausa;
// 4 h antes de la visita se cancela.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const escalera = require("../src/scheduler/citas-escalera");
const { pasoDeEscalera } = escalera;

const H = { dias: [0, 1, 2, 3, 4, 5, 6], desde: "08:00", hasta: "18:00" };
const A1 = { id: "a1", org_id: "org-1", name: "Daiana Zea", phone: "573011880668", alias_publico: "Asesor 1", activo: true, recibe_citas: true, orden_citas: 1, horario: H };
const A2 = { id: "a2", org_id: "org-1", name: "Claudia Valencia", phone: "573000008113", alias_publico: "Asesor 2", activo: true, recibe_citas: true, orden_citas: 2, horario: H };
const A3 = { id: "a3", org_id: "org-1", name: "Catherine Uribe", phone: "573028536489", alias_publico: "Asesor 3", activo: true, recibe_citas: true, orden_citas: 3, horario: H };
const CICLO = [A1, A2, A3];
const cita = (over = {}) => ({
  estado: "propuesta", fecha_hora: "2026-10-09T20:00:00Z", corte_at: "2026-10-09T16:00:00Z",
  creada_at: "2026-10-07T15:00:00Z", asignada_at: "2026-10-08T14:00:00Z", asesor_id: "a1",
  historial: [{ asesor_id: "a1", desde: "2026-10-08T14:00:00Z" }], ...over,
});
const lead = (over = {}) => ({ id: "l1", org_id: "org-1", nombre: "Laura", phone: "573125550000", source: "colega", cita: cita(over) });

test("antes de la hora no pasa nada", () => {
  assert.strictEqual(pasoDeEscalera({ lead: lead(), ciclo: CICLO, citasOrg: [], ahora: new Date("2026-10-08T14:59:00Z") }).accion, "nada");
});

test("a la hora rota al siguiente del ciclo", () => {
  const p = pasoDeEscalera({ lead: lead(), ciclo: CICLO, citasOrg: [], ahora: new Date("2026-10-08T15:00:00Z") });
  assert.strictEqual(p.accion, "rotar");
  assert.strictEqual(p.nuevo.id, "a2");
});

test("del último vuelve al primero", () => {
  const p = pasoDeEscalera({ lead: lead({ asesor_id: "a3" }), ciclo: CICLO, citasOrg: [], ahora: new Date("2026-10-08T15:00:00Z") });
  assert.strictEqual(p.nuevo.id, "a1");
});

test("de noche no rota (20:00-08:00 Bogotá)", () => {
  assert.strictEqual(pasoDeEscalera({ lead: lead(), ciclo: CICLO, citasOrg: [], ahora: new Date("2026-10-09T03:00:00Z") }).accion, "nada");
});

test("en el corte se cancela, aunque sea de noche", () => {
  const p = pasoDeEscalera({ lead: lead({ corte_at: "2026-10-09T03:00:00Z" }), ciclo: CICLO, citasOrg: [], ahora: new Date("2026-10-09T03:00:00Z") });
  assert.strictEqual(p.accion, "cortar");
});

describeRunOnce();

function describeRunOnce() {
  let enviados;
  const deps = () => ({
    aviso: async ({ advisor }) => { enviados.push({ to: advisor.phone, aviso: true }); return { ok: true }; },
    texto: async (_o, to, t) => { enviados.push({ to, t }); return { ok: true }; },
    plantilla: async (_o, to, opts) => { enviados.push({ to, plantilla: opts.name }); return { ok: true }; },
    org: async () => ({ id: "org-1", name: "Diamond" }),
    notificar: async (n) => { enviados.push({ nota: n.tipo, a: n.advisor.id }); return { ok: true }; },
  });

  beforeEach(() => {
    enviados = [];
    memory.leads.length = 0;
    memory.advisors.length = 0;
    memory.advisors.push({ ...A1 }, { ...A2 }, { ...A3 });
  });

  test("runOnce rota: la cita cambia de dueño, el nuevo recibe el aviso y el anterior se entera", async () => {
    memory.leads.push(lead());
    await escalera.runOnce({ ahora: new Date("2026-10-08T15:05:00Z"), deps: deps() });
    const c = memory.leads[0].cita;
    assert.strictEqual(c.asesor_id, "a2");
    assert.strictEqual(c.asignada_at, "2026-10-08T15:05:00.000Z");
    assert.strictEqual(c.historial.length, 2);
    assert.strictEqual(c.historial[0].hasta, "2026-10-08T15:05:00.000Z");
    assert.ok(enviados.find((e) => e.to === "573000008113" && e.aviso));
    assert.ok(!enviados.find((e) => e.to === "573011880668" && e.t), "sin WhatsApp al celular del anterior (plan 6)");
    assert.ok(enviados.find((e) => e.nota === "cita_reasignada" && e.a === "a1"), "el anterior ve la notificación");
  });

  test("runOnce corta: se cancela y al colega le sale cita_no_confirmada", async () => {
    memory.leads.push(lead({ corte_at: "2026-10-08T15:00:00Z" }));
    await escalera.runOnce({ ahora: new Date("2026-10-08T15:05:00Z"), deps: deps() });
    const c = memory.leads[0].cita;
    assert.strictEqual(c.estado, "cancelada");
    assert.strictEqual(c.motivo, "sin_confirmar");
    assert.ok(enviados.find((e) => e.to === "573125550000" && e.plantilla === "cita_no_confirmada"));
    assert.ok(enviados.find((e) => e.nota === "cita_cancelada" && e.a === "a1"));
  });

  test("runOnce no toca citas confirmadas ni las del flujo viejo (sin asesor_id)", async () => {
    memory.leads.push(lead({ estado: "confirmada" }));
    memory.leads.push({ id: "viejo", org_id: "org-1", phone: "573000000001", cita: { estado: "propuesta", fecha_hora: "2026-10-09T20:00:00Z", creada_at: "2026-10-07T15:00:00Z", advisor_id: "u1" } });
    await escalera.runOnce({ ahora: new Date("2026-10-08T15:05:00Z"), deps: deps() });
    assert.strictEqual(enviados.length, 0, "ni mensajes ni notificaciones");
  });
}

test("el servidor arranca la escalera", () => {
  const fuente = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "server.js"), "utf8");
  assert.match(fuente, /require\("\.\/scheduler\/citas-escalera"\)\.start\(\)/);
});
