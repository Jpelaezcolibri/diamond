// Confirmar u "otro horario" desde el boton de la plantilla (2026-10-07).
// Cualquiera del ciclo puede confirmar; la cita queda de quien confirma.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const cc = require("../src/lib/confirmar-cita");

const ORG = { id: "org-1", name: "Diamond" };
const A1 = { id: "a1", org_id: "org-1", name: "Daiana Zea", phone: "573011880668", alias_publico: "Asesor 1", activo: true, recibe_citas: true, orden_citas: 1, auth_user_id: "u1" };
const A2 = { id: "a2", org_id: "org-1", name: "Claudia Valencia", phone: "573000008113", alias_publico: "Asesor 2", activo: true, recibe_citas: true, orden_citas: 2, auth_user_id: null };
const RESPALDO = { id: "a1b", org_id: "org-1", name: "Daiana Zea (línea 2)", phone: "573001878024", alias_publico: "Asesor 1", activo: true, recibe_citas: false };
const NATALIA = { id: "n", org_id: "org-1", name: "Natalia Velez", phone: "573001878024", activo: false };

let enviados;
const deps = () => ({
  texto: async (_o, to, t) => { enviados.push({ to, t }); return { ok: true }; },
  plantilla: async (_o, to, opts) => { enviados.push({ to, plantilla: opts.name }); return { ok: true }; },
  soloLlamada: async () => false,
  notificar: async (n) => { enviados.push({ nota: n.tipo, a: n.advisor.id }); return { ok: true }; },
});

beforeEach(() => {
  enviados = [];
  memory.leads.length = 0;
  memory.advisors.length = 0;
  memory.advisors.push(A1, A2, RESPALDO, NATALIA);
  memory.leads.push({
    id: "l1", org_id: "org-1", nombre: "Laura", phone: "573125550000", source: "colega",
    cita: {
      estado: "propuesta", fecha_hora: "2026-10-09T20:00:00Z", ref: "10012722", asesor_id: "a2", advisor_id: null,
      historial: [{ asesor_id: "a1", desde: "x", hasta: "y" }, { asesor_id: "a2", desde: "y" }],
    },
  });
});

test("confirmar: queda de quien confirma, el colega recibe el alias y el anterior se entera", async () => {
  const r = await cc.confirmar({ org: ORG, lead: memory.leads[0], advisor: A1, deps: deps() });
  assert.strictEqual(r.ok, true);
  const c = memory.leads[0].cita;
  assert.strictEqual(c.estado, "confirmada");
  assert.strictEqual(c.asesor_id, "a1");
  assert.strictEqual(c.advisor_id, "u1");
  const alColega = enviados.find((e) => e.to === "573125550000");
  assert.match(alColega.t, /Te recibe Asesor 1\./);
  assert.doesNotMatch(alColega.t, /Daiana|573011880668/);
  assert.ok(!enviados.find((e) => e.to === "573000008113" && e.t), "sin WhatsApp al celular de Claudia (plan 6)");
  assert.ok(enviados.find((e) => e.nota === "cita_confirmada" && e.a === "a2"), "y lo ve en la campana");
});

test("botón desde el 8024: se resuelve a Asesor 1 activo, no a Natalia", async () => {
  await cc.procesarBotonCita(ORG, "573001878024", "cita:l1:confirmar", { deps: deps() });
  assert.strictEqual(memory.leads[0].cita.asesor_id, "a1");
  assert.strictEqual(memory.leads[0].cita.confirmada_por, "Daiana Zea");
});

test("otro horario: se cancela y al colega le sale la plantilla cita_no_confirmada", async () => {
  await cc.procesarBotonCita(ORG, "573000008113", "cita:l1:otro", { deps: deps() });
  assert.strictEqual(memory.leads[0].cita.estado, "cancelada");
  assert.strictEqual(memory.leads[0].cita.motivo, "asesor_pidio_otro_horario");
  assert.ok(enviados.find((e) => e.to === "573125550000" && e.plantilla === "cita_no_confirmada"));
});

test("una cita que ya no está propuesta no se vuelve a confirmar", async () => {
  memory.leads[0].cita.estado = "confirmada";
  await cc.procesarBotonCita(ORG, "573000008113", "cita:l1:confirmar", { deps: deps() });
  assert.ok(enviados.find((e) => e.to === "573000008113" && /ya estaba confirmada/.test(e.t)));
  assert.strictEqual(memory.leads[0].cita.asesor_id, "a2", "no cambió de dueño");
});

test("un número que no es asesor activo no puede tocar la cita", async () => {
  await cc.procesarBotonCita(ORG, "573129999999", "cita:l1:confirmar", { deps: deps() });
  assert.strictEqual(memory.leads[0].cita.estado, "propuesta");
});
