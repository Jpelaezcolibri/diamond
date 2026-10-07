// agendar_cita con reglas y rotacion (Juan, 2026-10-07): 24 h de
// anticipacion, 60+90 min por asesor, y la cita va a un asesor del ciclo.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const { executeTool } = require("../src/agent/tools");

const H = { dias: [0, 1, 2, 3, 4, 5, 6], desde: "08:00", hasta: "18:00" };
const A1 = { id: "a1", org_id: "org-1", name: "Daiana Zea", phone: "573011880668", alias_publico: "Asesor 1", activo: true, recibe_citas: true, orden_citas: 1, auth_user_id: "u1", horario: H, especialidad: "venta" };
const A2 = { id: "a2", org_id: "org-1", name: "Claudia Valencia", phone: "573000008113", alias_publico: "Asesor 2", activo: true, recibe_citas: true, orden_citas: 2, auth_user_id: null, horario: H, especialidad: "venta" };

const leadBase = () => ({ id: "l1", org_id: "org-1", phone: "573125550000", nombre: "Laura", source: "colega" });
const ctx = () => ({ org: { id: "org-1", name: "Diamond" }, lead: { ...leadBase() }, colega: { nombre: "Laura", telefono: "573125550000" } });
const enHoras = (h) => new Date(Date.now() + h * 3600 * 1000);
// Las 10:00 de Bogota del dia de `d`.
const aLas10 = (d) => { const x = new Date(d); x.setUTCHours(15, 0, 0, 0); return x.toISOString(); };

beforeEach(() => {
  memory.leads.length = 0;
  memory.advisors.length = 0;
  memory.advisors.push({ ...A1 }, { ...A2 });
  memory.leads.push(leadBase());
});

test("a menos de 24 h no se agenda y Sofi recibe 3 horarios válidos", async () => {
  const c = ctx();
  const out = await executeTool("agendar_cita", { descripcion: "visita", tipo: "visita", fecha_hora_iso: enHoras(5).toISOString(), ref: "10012722" }, c);
  assert.match(out, /No se pudo agendar: necesitamos al menos 24 horas/);
  assert.strictEqual((out.match(/^- /gm) || []).length, 3);
  assert.strictEqual(c.lead.cita, undefined, "no se guarda nada");
});

test("con 24 h y hora libre: queda propuesta, de un asesor del ciclo, con corte e historial", async () => {
  const c = ctx();
  const iso = aLas10(enHoras(72));
  const out = await executeTool("agendar_cita", { descripcion: "visita", tipo: "visita", fecha_hora_iso: iso, ref: "10012722" }, c);
  const cita = c.lead.cita;
  assert.strictEqual(cita.estado, "propuesta");
  assert.ok(["a1", "a2"].includes(cita.asesor_id));
  assert.strictEqual(cita.corte_at, new Date(new Date(iso).getTime() - 4 * 3600 * 1000).toISOString());
  assert.strictEqual(cita.historial.length, 1);
  assert.strictEqual(cita.historial[0].asesor_id, cita.asesor_id);
  assert.strictEqual(c.appointmentAlert.porPlantilla, true);
  assert.match(out, /SOLICITADA/);
  assert.doesNotMatch(out, /573011880668|573000008113|Daiana|Claudia/);
});

test("si un asesor ya tiene esa hora, la cita va al otro", async () => {
  const iso = aLas10(enHoras(72));
  memory.leads.push({ id: "otro", org_id: "org-1", phone: "573000000999", cita: { asesor_id: "a1", fecha_hora: iso, estado: "confirmada" } });
  const c = ctx();
  await executeTool("agendar_cita", { descripcion: "visita", tipo: "visita", fecha_hora_iso: iso }, c);
  assert.strictEqual(c.lead.cita.asesor_id, "a2");
});

test("sin asesores en el ciclo, agendar_cita se comporta como antes (sin rotación)", async () => {
  memory.advisors.forEach((a) => (a.recibe_citas = false));
  const c = ctx();
  // Hora fija dentro del horario: el camino viejo valida horario y, a "dentro
  // de 5 h", el resultado dependeria de la hora en que corre el test.
  await executeTool("agendar_cita", { descripcion: "visita", tipo: "visita", fecha_hora_iso: aLas10(enHoras(72)) }, c);
  assert.strictEqual(c.lead.cita.estado, "propuesta");
  assert.strictEqual(c.lead.cita.asesor_id, undefined);
});

const fs = require("node:fs");
const path = require("node:path");
test("el webhook entrega la cita de la rotación por plantilla", () => {
  const fuente = fs.readFileSync(path.join(__dirname, "..", "src", "channels", "whatsapp.js"), "utf8");
  assert.match(fuente, /appointmentAlert\.porPlantilla/);
  assert.match(fuente, /avisarCitaPorConfirmar\(/);
});
