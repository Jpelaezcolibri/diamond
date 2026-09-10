// El colega que pide hablar con una persona (Juan, 2026-09-10). Caso real:
// Santiago pregunto "¿Es posible hablar con alguien?", Sofi le dijo "te puedo
// conectar con un asesor" y no le aviso a nadie. Lo que se fija: el aviso sale
// en el momento a la asesora principal del radar con copia al escalado (igual
// que una cita de colega), no se repite en 30 minutos, y Sofi nunca recibe un
// texto que le permita decir "ya le avise" si el aviso no salio.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");

const memory = require("../src/data/memory");
const tools = require("../src/agent/tools");
const { executeTool, TOOL_DEFINITIONS } = tools;
const advisors = require("../src/data/advisors");
const groupSignals = require("../src/data/group-signals");
const mensajeAsesor = require("../src/lib/mensaje-asesor");

const DAIANA = { id: "adv-daiana", name: "Daiana Zea", phone: "573011880668" };
const ctxColega = (extra = {}) => ({
  org: { id: "org-1", name: "Diamond" },
  lead: { id: "lead-santiago", phone: "573125802350", nombre: null },
  colega: { lid: "111111111111111", telefono: "573125802350", nombre: "Santiago" },
  ...extra,
});

let envios;
let escaladoAntes;
beforeEach(() => {
  envios = [];
  tools._resetPedidosContacto();
  memory.colegasGrupos.length = 0;
  escaladoAntes = process.env.RADAR_ESCALADO_PHONE;
  process.env.RADAR_ESCALADO_PHONE = "573028536489";
});
afterEach(() => {
  if (escaladoAntes === undefined) delete process.env.RADAR_ESCALADO_PHONE;
  else process.env.RADAR_ESCALADO_PHONE = escaladoAntes;
});

function mocks(t, { enviarOk = true, asesora = DAIANA, pedido = null } = {}) {
  t.mock.method(advisors, "findAsesorPrincipalRadar", async () => asesora);
  t.mock.method(groupSignals, "buscarPorTelefono", async () => pedido);
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async (org, telefono, texto) => {
    envios.push({ telefono, texto });
    return enviarOk ? { ok: true } : { ok: false, error: "fuera de la ventana de 24h" };
  });
}

test("la tool esta declarada y separa al colega del cliente", () => {
  const def = TOOL_DEFINITIONS.find((d) => d.name === "pedir_contacto_asesora");
  assert.ok(def);
  assert.match(def.description, /transferir_a_asesor/);
});

test("un colega pide hablar con alguien: aviso inmediato a la asesora con copia al escalado, y Sofi recibe el contacto", async (t) => {
  mocks(t, { pedido: { texto_original: "Busco apto en Laureles 3 alcobas", respuesta_refs: ["9921137", "10129664"] } });

  const out = await executeTool("pedir_contacto_asesora", { motivo: "coordinar una visita" }, ctxColega());

  assert.deepStrictEqual(envios.map((e) => e.telefono), ["573011880668", "573028536489"], "asesora y copia al escalado");
  const aviso = envios[0].texto;
  assert.match(aviso, /^🙋 Un colega pide hablar con una asesora — comunicate ya/);
  assert.match(aviso, /Colega: Santiago/);
  assert.match(aviso, /Contacto: https:\/\/wa\.me\/573125802350/);
  assert.match(aviso, /Para qué: coordinar una visita/);
  assert.match(aviso, /Busco apto en Laureles/);
  assert.match(aviso, /Ref 9921137, Ref 10129664/);
  assert.doesNotMatch(aviso, /contactalo|llamalo|llamala/i, "copy neutro");
  assert.match(out, /^Listo: ya le avisé a Daiana Zea/);
  assert.match(out, /\+57 301 188 0668/);
});

test("si lo vuelve a pedir en 30 minutos no sale un segundo aviso", async (t) => {
  mocks(t);
  await executeTool("pedir_contacto_asesora", {}, ctxColega());
  const out = await executeTool("pedir_contacto_asesora", {}, ctxColega());
  assert.strictEqual(envios.length, 2, "solo los dos envios del primer pedido (asesora + copia)");
  assert.match(out, /^Ya le avisé a Daiana Zea hace un rato/);
});

test("un colega 'solo llamada': el aviso trae el numero para marcar, no un link para escribirle", async (t) => {
  mocks(t);
  memory.colegasGrupos.push({ id: "c1", org_id: "org-1", lid: "111111111111111", telefono: "573125802350", nombre: "Santiago", grupos: [], solo_llamada: true });
  await executeTool("pedir_contacto_asesora", {}, ctxColega());
  assert.match(envios[0].texto, /Contacto: 📞 \+57 312 580 2350 — pidió contacto solo por llamada: llamá, no le escribas/);
  assert.doesNotMatch(envios[0].texto, /wa\.me/);
});

test("si el aviso no llega, Sofi NO puede decir que aviso, y el pedido no queda marcado como repetido", async (t) => {
  mocks(t, { enviarOk: false });
  const out = await executeTool("pedir_contacto_asesora", {}, ctxColega());
  assert.match(out, /^NO le llegó el aviso a Daiana Zea/);
  assert.match(out, /NO le digas al colega que ya le avisaste/);
  assert.doesNotMatch(out, /^Listo/);

  const reintento = await executeTool("pedir_contacto_asesora", {}, ctxColega());
  assert.doesNotMatch(reintento, /^Ya le avisé/, "un aviso que no salio no cuenta como repetido");
});

test("con alguien que no es colega no aplica y no avisa a nadie", async (t) => {
  mocks(t);
  const out = await executeTool("pedir_contacto_asesora", {}, ctxColega({ colega: null }));
  assert.match(out, /^No aplica/);
  assert.strictEqual(envios.length, 0);
});

test("sin asesora configurada, texto honesto y ningun envio", async (t) => {
  mocks(t, { asesora: null });
  const out = await executeTool("pedir_contacto_asesora", {}, ctxColega());
  assert.match(out, /^NO pude avisarle a nadie/);
  assert.strictEqual(envios.length, 0);
});
