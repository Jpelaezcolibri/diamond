const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const cp = require("../src/data/contactos-pendientes");
const { aplicar } = require("../src/lib/aplicar-pendiente");

const ORG = { id: "o1", name: "Diamond" };
const ADV = { id: "a1", name: "Daiana" };
let log, lead, pend;
const deps = () => ({
  actualizarLead: async (id, patch) => { log.push({ lead: patch }); Object.assign(lead, patch); return lead; },
  nota: async (convId, texto) => { log.push({ nota: texto }); },
  confirmarCita: async ({ lead: l, advisor }) => { log.push({ confirmar: l.cita, advisor: advisor.id }); return { ok: true }; },
});

beforeEach(async () => {
  memory.contactosPendientes.length = 0;
  log = [];
  lead = { id: "l1", phone: "573014521622", nombre: "Clara", source: "colega", estado: "nuevo", atencion_pendiente: "sin_respuesta" };
  pend = (await cp.abrir({ orgId: "o1", leadId: "l1", conversationId: "c1", asesorId: "a1", motivo: "no_contesto" })).pendiente;
});

test("agendó visita: crea la cita y la confirma esa asesora", async () => {
  const r = await aplicar({ org: ORG, advisor: ADV, pendiente: pend, lead, accion: { tipo: "visita", fechaHoraIso: "2026-10-31T15:00:00.000Z", ref: "10414675", nota: "con la esposa" }, deps: deps() });
  assert.deepStrictEqual(r, { ok: true, resumen: "visita" });
  const c = log.find((x) => x.confirmar);
  assert.deepStrictEqual([c.confirmar.fecha_hora, c.confirmar.ref, c.confirmar.origen, c.advisor], ["2026-10-31T15:00:00.000Z", "10414675", "excel", "a1"]);
  assert.match(log.find((x) => x.nota).nota, /Daiana \(Excel\): Agendó visita.*ref 10414675.*con la esposa/);
  assert.strictEqual(lead.atencion_pendiente, null);
  assert.strictEqual((await cp.abiertos("o1")).length, 0);
});

test("no contesta: vuelve a la cola; al tercer intento se cierra y el lead queda perdido", async () => {
  const acc = { tipo: "no_contesta", nota: "" };
  assert.strictEqual((await aplicar({ org: ORG, advisor: ADV, pendiente: pend, lead, accion: acc, deps: deps() })).resumen, "no_contesta");
  let [p] = await cp.porCodigos("o1", [pend.codigo]);
  assert.deepStrictEqual([p.estado, p.intentos], ["pendiente", 1]);
  await aplicar({ org: ORG, advisor: ADV, pendiente: p, lead, accion: acc, deps: deps() });
  [p] = await cp.porCodigos("o1", [pend.codigo]);
  const r = await aplicar({ org: ORG, advisor: ADV, pendiente: p, lead, accion: acc, deps: deps() });
  assert.strictEqual(r.resumen, "cerrado");
  assert.strictEqual(lead.estado, "cerrado_perdido");
  assert.strictEqual((await cp.abiertos("o1")).length, 0);
});

test("no le interesa cierra; número equivocado descarta; interesado deja nota", async () => {
  assert.strictEqual((await aplicar({ org: ORG, advisor: ADV, pendiente: pend, lead, accion: { tipo: "no_interesa", nota: "" }, deps: deps() })).resumen, "cerrado");
  assert.strictEqual(lead.estado, "cerrado_perdido");
  const p2 = (await cp.abrir({ orgId: "o1", leadId: "l1", asesorId: "a1", motivo: "x" })).pendiente;
  await aplicar({ org: ORG, advisor: ADV, pendiente: p2, lead, accion: { tipo: "numero_equivocado", nota: "" }, deps: deps() });
  assert.strictEqual(lead.estado, "descartado");
  const p3 = (await cp.abrir({ orgId: "o1", leadId: "l1", asesorId: "a1", motivo: "x" })).pendiente;
  assert.strictEqual((await aplicar({ org: ORG, advisor: ADV, pendiente: p3, lead, accion: { tipo: "interesado", nota: "llamar el lunes" }, deps: deps() })).resumen, "nota");
});

test("aplicar dos veces no duplica", async () => {
  const acc = { tipo: "interesado", nota: "" };
  await aplicar({ org: ORG, advisor: ADV, pendiente: pend, lead, accion: acc, deps: deps() });
  log = [];
  const r = await aplicar({ org: ORG, advisor: ADV, pendiente: pend, lead, accion: acc, deps: deps() });
  assert.deepStrictEqual(r, { ok: true, resumen: "ya_aplicado" });
  assert.strictEqual(log.length, 0);
});
