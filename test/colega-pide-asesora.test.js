// El colega que pide hablar con una persona (Juan, 2026-09-10). Caso real:
// Santiago pregunto "¿Es posible hablar con alguien?", Sofi le dijo "te puedo
// conectar con un asesor" y no le aviso a nadie.
//
// Desde 2026-10-07 (plan 6, "todo al chat del CRM") el pedido NO va al celular
// de la asesora: queda en el chat de ese colega, asignado a ella, con aviso en
// la app y uno corto por WhatsApp (avisar-asesor.js). Lo que se fija: el aviso
// sale en el momento, no se repite en 24 h (Juan, 2026-11-15; antes 30 min),
// no sale si ya hay una visita por confirmar (la asesora ya la tiene por la
// escalera), Sofi nunca recibe un nombre ni el celular (siempre "un asesor de
// nuestro equipo") y nunca puede decir "ya le avise" si no salio.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const memory = require("../src/data/memory");
const tools = require("../src/agent/tools");
const { executeTool, TOOL_DEFINITIONS } = tools;
const advisors = require("../src/data/advisors");
const groupSignals = require("../src/data/group-signals");
const avisarAsesorMod = require("../src/notifications/avisar-asesor");

const DAIANA = { id: "adv-daiana", name: "Daiana Zea", phone: "573011880668", alias_publico: "Asesor 1" };
const ctxColega = (extra = {}) => ({
  org: { id: "org-1", name: "Diamond" },
  lead: { id: "lead-santiago", phone: "573125802350", nombre: null },
  colega: { lid: "111111111111111", telefono: "573125802350", nombre: "Santiago" },
  ...extra,
});

let avisos;
beforeEach(() => {
  avisos = [];
  tools._resetPedidosContacto();
  memory.colegasGrupos.length = 0;
});

function mocks(t, { avisoOk = true, asesora = DAIANA, pedido = null } = {}) {
  t.mock.method(advisors, "findAsesorPrincipalRadar", async () => asesora);
  t.mock.method(groupSignals, "buscarPorTelefono", async () => pedido);
  t.mock.method(avisarAsesorMod, "avisarAsesor", async (args) => {
    avisos.push(args);
    return avisoOk ? { ok: true } : { ok: false, error: "no se pudo" };
  });
}

test("la tool esta declarada y separa al colega del cliente", () => {
  const def = TOOL_DEFINITIONS.find((d) => d.name === "pedir_contacto_asesora");
  assert.ok(def);
  assert.match(def.description, /transferir_a_asesor/);
});

test("un colega pide hablar con alguien: queda en su chat, asignado a la asesora, y Sofi no recibe nombres", async (t) => {
  mocks(t, { pedido: { texto_original: "Busco apto en Laureles 3 alcobas", respuesta_refs: ["9921137", "10129664"] } });

  const out = await executeTool("pedir_contacto_asesora", { motivo: "coordinar una visita" }, ctxColega());

  assert.strictEqual(avisos.length, 1);
  const a = avisos[0];
  assert.strictEqual(a.motivo, "pide_asesor");
  assert.strictEqual(a.advisor, DAIANA);
  assert.strictEqual(a.lead.id, "lead-santiago");
  assert.match(a.titulo, /Santiago pide hablar con un asesor/);
  assert.match(a.cuerpo, /Para qué: coordinar una visita/);
  assert.match(a.cuerpo, /Busco apto en Laureles/);
  assert.match(a.cuerpo, /Ref 9921137, Ref 10129664/);
  // Juan (2026-11-15): hacia el colega nunca un nombre; se dice una sola vez.
  assert.strictEqual(out.startsWith("Listo: el aviso quedó hecho. Dile una sola vez que un asesor de nuestro equipo se contactará con él."), true, out);
  assert.doesNotMatch(out, /Asesor \d/);
  assert.doesNotMatch(out, /Daiana|Claudia|Catherine/, "Sofi no recibe el nombre de la asesora (2026-11-15)");
  assert.doesNotMatch(out, /Zea|301 188 0668|573011880668/, "ni el apellido ni el celular");
  assert.match(out, /NO le des ningún número/);
  assert.match(out, /NO prometas una hora/);
});

test("si lo vuelve a pedir dentro de 24 h no sale un segundo aviso", async (t) => {
  mocks(t);
  const t0 = Date.parse("2026-11-15T14:00:00Z");
  let ahora = t0;
  t.mock.method(Date, "now", () => ahora);
  await executeTool("pedir_contacto_asesora", {}, ctxColega());
  ahora = t0 + 23 * 3600e3; // 23 h despues: antes (30 min) ya habria salido otro
  const out = await executeTool("pedir_contacto_asesora", {}, ctxColega());
  assert.strictEqual(avisos.length, 1);
  assert.match(out, /^El equipo ya tiene el aviso; NO se manda otro\./);
  assert.match(out, /dile una vez que un asesor de nuestro equipo se contactará con él/);
  assert.match(out, /Si ya se lo dijiste, no lo repitas/);
  assert.doesNotMatch(out, /Asesor \d/);
  assert.doesNotMatch(out, /Daiana|301 188 0668/);
});

test("pasadas 24 h, un nuevo pedido si vuelve a avisar", async (t) => {
  mocks(t);
  const t0 = Date.parse("2026-11-15T14:00:00Z");
  let ahora = t0;
  t.mock.method(Date, "now", () => ahora);
  await executeTool("pedir_contacto_asesora", {}, ctxColega());
  ahora = t0 + 24 * 3600e3 + 60e3;
  const out = await executeTool("pedir_contacto_asesora", {}, ctxColega());
  assert.strictEqual(avisos.length, 2);
  assert.match(out, /^Listo: el aviso quedó hecho\./);
});

test("con una visita por confirmar (propuesta) no sale aviso nuevo: la asesora ya lo tiene por la escalera", async (t) => {
  mocks(t);
  const lead = { id: "lead-santiago", phone: "573125802350", nombre: null, cita: { estado: "propuesta", fecha_hora: "2026-11-20T15:00:00Z", ref: "10550349" } };
  const out = await executeTool("pedir_contacto_asesora", {}, ctxColega({ lead }));
  assert.strictEqual(avisos.length, 0);
  assert.match(out, /^El equipo ya tiene el aviso; NO se manda otro\./);
  assert.match(out, /un asesor de nuestro equipo/);
  assert.doesNotMatch(out, /Daiana|Claudia|Catherine|Asesor \d/);
  // Y queda marcado: insistir no dispara nada.
  await executeTool("pedir_contacto_asesora", {}, ctxColega({ lead }));
  assert.strictEqual(avisos.length, 0);
});

test("con una visita cancelada si sale el aviso", async (t) => {
  mocks(t);
  const lead = { id: "lead-santiago", phone: "573125802350", nombre: null, cita: { estado: "cancelada", fecha_hora: "2026-11-20T15:00:00Z", ref: "10550349" } };
  const out = await executeTool("pedir_contacto_asesora", {}, ctxColega({ lead }));
  assert.strictEqual(avisos.length, 1);
  assert.match(out, /^Listo: el aviso quedó hecho\./);
});

test("un colega 'solo llamada': la asesora lo ve en el aviso con el número para marcar", async (t) => {
  mocks(t);
  memory.colegasGrupos.push({ id: "c1", org_id: "org-1", lid: "111111111111111", telefono: "573125802350", nombre: "Santiago", grupos: [], solo_llamada: true });
  await executeTool("pedir_contacto_asesora", {}, ctxColega());
  assert.match(avisos[0].cuerpo, /Pidió contacto solo por llamada: \+57 312 580 2350/);
});

test("si el aviso no sale, Sofi NO puede decir que aviso, y el pedido no queda marcado como repetido", async (t) => {
  mocks(t, { avisoOk: false });
  const out = await executeTool("pedir_contacto_asesora", {}, ctxColega());
  assert.match(out, /^NO le llegó el aviso a nadie/);
  assert.doesNotMatch(out, /301 188 0668|573011880668/, "ni siquiera cuando falla se le da el celular");
  assert.match(out, /el equipo le va a escribir/);
  assert.match(out, /NO le digas al colega que ya le avisaste/);
  assert.doesNotMatch(out, /^Listo/);

  const reintento = await executeTool("pedir_contacto_asesora", {}, ctxColega());
  assert.doesNotMatch(reintento, /^Ya le avisé/, "un aviso que no salio no cuenta como repetido");
});

test("con alguien que no es colega no aplica y no avisa a nadie", async (t) => {
  mocks(t);
  const out = await executeTool("pedir_contacto_asesora", {}, ctxColega({ colega: null }));
  assert.match(out, /^No aplica/);
  assert.strictEqual(avisos.length, 0);
});

test("sin asesora configurada, texto honesto y ningun aviso", async (t) => {
  mocks(t, { asesora: null });
  const out = await executeTool("pedir_contacto_asesora", {}, ctxColega());
  assert.match(out, /^NO pude avisarle a nadie/);
  assert.strictEqual(avisos.length, 0);
});
