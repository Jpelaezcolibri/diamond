// La escalera de una cita por confirmar (Juan, 2026-10-07): cada hora pasa al
// siguiente asesor del ciclo, hasta que alguien confirme; de noche se pausa;
// al llegar el corte (la visita menos 12 h, en horario habil) se cancela.
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

test("domingo: la escalera no rota ni reavisa, pero el corte sigue cortando", () => {
  const dom = new Date("2026-10-25T17:00:00Z"); // domingo 12:00 Bogota
  const l = lead({ asignada_at: "2026-10-25T10:00:00Z", corte_at: "2026-10-26T01:00:00Z", fecha_hora: "2026-10-26T20:00:00Z" });
  assert.strictEqual(pasoDeEscalera({ lead: l, ciclo: CICLO, citasOrg: [], ahora: dom }).accion, "nada");
  assert.strictEqual(escalera.tocaReaviso({ lead: l, ahora: dom }), false);
  const vencido = lead({ asignada_at: "2026-10-25T10:00:00Z", corte_at: "2026-10-25T15:00:00Z", fecha_hora: "2026-10-26T20:00:00Z" });
  assert.strictEqual(pasoDeEscalera({ lead: vencido, ciclo: CICLO, citasOrg: [], ahora: dom }).accion, "cortar");
});

// ---------- Visita sin relevo (caso Nancy, 2026-11-06) ----------
// Visita un sabado: Daiana y Claudia no tienen sabados en el horario, asi que
// la escalera no tenia a quien pasarsela y se quedo 2 dias en Catherine con un
// solo aviso, mientras el CRM prometia "pasa a la siguiente asesora".
const LV = { dias: [1, 2, 3, 4, 5], desde: "08:00", hasta: "18:00" };
const S1 = { ...A1, horario: LV };
const S2 = { ...A2, horario: LV };
const S3 = { ...A3 }; // todos los dias
const CICLO_SABADO = [S1, S2, S3];
const citaSabado = (over = {}) =>
  lead({
    asesor_id: "a3", fecha_hora: "2026-11-07T15:00:00Z", corte_at: "2026-11-07T13:00:00Z",
    creada_at: "2026-11-04T22:22:00Z", asignada_at: "2026-11-04T22:22:00Z", reaviso_at: "2026-11-04T22:42:00Z",
    historial: [{ asesor_id: "a3", desde: "2026-11-04T22:22:00Z" }], ...over,
  });

test("sin relevo: si nadie mas puede tomar la visita, la escalera lo dice en vez de nada", () => {
  const p = pasoDeEscalera({ lead: citaSabado(), ciclo: CICLO_SABADO, citasOrg: [], ahora: new Date("2026-11-05T15:00:00Z") });
  assert.strictEqual(p.accion, "sin_relevo");
});

test("sin relevo: el reaviso a la asesora se repite cada 2 h, no una sola vez", () => {
  const l = citaSabado();
  assert.strictEqual(escalera.tocaReaviso({ lead: l, ahora: new Date("2026-11-05T02:00:00Z"), sinRelevo: true }), false, "de noche no");
  assert.strictEqual(escalera.tocaReaviso({ lead: l, ahora: new Date("2026-11-05T15:00:00Z") }), false, "sin relevo no declarado: una vez por asignacion");
  assert.strictEqual(escalera.tocaReaviso({ lead: l, ahora: new Date("2026-11-05T00:30:00Z"), sinRelevo: true }), false, "paso 1 h 48 min: todavia no");
  assert.strictEqual(escalera.tocaReaviso({ lead: l, ahora: new Date("2026-11-05T15:00:00Z"), sinRelevo: true }), true);
});

test("runOnce sin relevo: marca la cita, avisa a las otras asesoras y a Juan una sola vez, y reavisa a la actual", async () => {
  memory.leads.length = 0;
  memory.advisors.length = 0;
  memory.advisors.push({ ...S1 }, { ...S2 }, { ...S3 });
  memory.leads.push(citaSabado());
  const enviados = [];
  const alertas = [];
  const deps = {
    aviso: async () => ({ ok: true }),
    org: async () => ({ id: "org-1", name: "Diamond" }),
    notificar: async (n) => { enviados.push({ nota: n.tipo, a: n.advisor.id }); return { ok: true }; },
    reaviso: async ({ advisor }) => { enviados.push({ reaviso: advisor.id }); return { ok: true }; },
    alertaTecnica: async (resumen) => { alertas.push(resumen); },
  };
  const ahora = new Date("2026-11-05T15:00:00Z");
  const r = await escalera.runOnce({ ahora, deps });
  const c = memory.leads[0].cita;
  assert.strictEqual(c.asesor_id, "a3", "no rota: nadie mas puede");
  assert.strictEqual(c.sin_relevo_at, ahora.toISOString());
  assert.deepStrictEqual(enviados.filter((e) => e.nota === "cita_sin_relevo").map((e) => e.a).sort(), ["a1", "a2"]);
  assert.strictEqual(alertas.length, 1);
  assert.match(alertas[0], /sin relevo/i);
  assert.ok(enviados.some((e) => e.reaviso === "a3"), "la actual recibe el reaviso");
  assert.strictEqual(r.reavisadas, 1);

  // Segunda corrida 1 h despues: ni campanas ni alerta de nuevo; el reaviso aun no toca.
  enviados.length = 0;
  alertas.length = 0;
  await escalera.runOnce({ ahora: new Date("2026-11-05T16:00:00Z"), deps });
  assert.strictEqual(enviados.length, 0);
  assert.strictEqual(alertas.length, 0);
  // A las 2 h del reaviso anterior, vuelve a reavisar a la actual.
  await escalera.runOnce({ ahora: new Date("2026-11-05T17:01:00Z"), deps });
  assert.deepStrictEqual(enviados, [{ reaviso: "a3" }]);
});
