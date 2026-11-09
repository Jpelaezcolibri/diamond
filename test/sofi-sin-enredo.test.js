// Caso Norha Vélez (2026-11-07 al 09): colega con visita a la Ref 10505674.
// Sofi le dijo "te coordina Asesor 1", luego "Asesor 3", luego otra vez
// "Asesor 1"; le dijo "solicitada" y después "confirmada" sin explicar; le
// prometió que la llamaban "hoy" y nadie lo hizo. Juan (2026-11-09): "para el
// cliente debe de ser indiferente, solo decirle que un asesor lo va a
// contactar es más que suficiente".
//
// Lo que se fija acá:
// 1. Hacia el cliente o colega nunca sale "Asesor N" ni el nombre real.
// 2. La confirmación que le llega queda guardada en su chat (Sofi la ve).
// 3. El prompt dice sin ambigüedad si la cita está SOLICITADA o CONFIRMADA.
// 4. "Quiero hablar con una persona" le llega a quien tiene la cita.
// 5. Un colega sin celular visible: los avisos lo dicen y Sofi le pide el número.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const tools = require("../src/agent/tools");
const { executeTool } = tools;
const advisors = require("../src/data/advisors");
const groupSignals = require("../src/data/group-signals");
const leads = require("../src/data/leads");
const avisarAsesorMod = require("../src/notifications/avisar-asesor");
const ip = require("../src/lib/identidad-publica");
const { buildSystemPrompt } = require("../src/agent/prompts");
const { confirmar } = require("../src/lib/confirmar-cita");
const { avisarCitaPorConfirmar } = require("../src/notifications/aviso-cita");

const ORG = { id: "org-1", name: "Diamond" };
const DAIANA = { id: "a1", name: "Daiana Zea", phone: "573011880668", alias_publico: "Asesor 1" };
const CATHERINE = { id: "a3", name: "Catherine Uribe", phone: "573028536489", alias_publico: "Asesor 3" };
const SIN_ALIAS = /Asesor\s*\d|Asesor N\b|Daiana|Catherine|Claudia/;
const NORHA_TEL = "CO.1622610936270244";
const citaConfirmada = { tipo: "visita", ref: "10505674", estado: "confirmada", asesor_id: "a3", fecha_hora: "2026-11-10T10:00:00-05:00", confirmada_at: "2026-11-07T23:12:43Z" };
const citaSolicitada = { tipo: "visita", ref: "10505674", estado: "propuesta", asesor_id: "a3", fecha_hora: "2026-11-10T10:00:00-05:00", corte_at: "2026-11-10T01:00:00Z" };

beforeEach(() => { tools._resetPedidosContacto(); });

// ── 1. Nunca "Asesor N" hacia afuera ──────────────────────────────────────

test("hacia afuera el asesor es siempre 'un asesor de nuestro equipo', tenga o no alias", () => {
  assert.strictEqual(ip.asesorPublico(), "un asesor de nuestro equipo");
  const t = ip.textoCitaConfirmada({ cuando: "del martes 10 de noviembre a las 10:00 a. m.", ref: "10505674" });
  assert.strictEqual(t, "Tu visita del martes 10 de noviembre a las 10:00 a. m. a la ref 10505674 quedó CONFIRMADA. Te recibe un asesor de nuestro equipo.");
  const tr = ip.instruccionTransferencia({ especialidad: "venta", advisor: DAIANA, org: ORG });
  assert.doesNotMatch(tr, SIN_ALIAS);
  assert.match(tr, /un asesor de nuestro equipo/);
  assert.strictEqual(ip.aliasPublico, undefined, "ya no existe la función que sacaba el alias hacia afuera");
});

test("adentro (CRM) sí se rotula con el alias o el nombre", () => {
  assert.strictEqual(ip.aliasInterno(CATHERINE), "Asesor 3");
  assert.strictEqual(ip.aliasInterno({ name: "Claudia Valencia" }), "Claudia Valencia");
});

test("el prompt del colega no le enseña a Sofi a nombrar asesores", () => {
  const texto = buildSystemPrompt({
    org: ORG, lead: { id: "l", phone: NORHA_TEL, cita: citaConfirmada }, qualified: false,
    now: { legible: "lunes 9 de noviembre de 2026, 3:20 p. m.", iso: "2026-11-09T15:20:00-05:00" },
    colega: { nombre: "Norha Velez M" }, coordinador: { alias: "Asesor 3" },
  }).map((b) => b.text).join("\n");
  assert.doesNotMatch(texto, /Asesor\s*\d|alias como/);
  assert.match(texto, /un asesor de nuestro equipo/);
  assert.match(texto, /NUNCA (nombres|digas) .*(número|nombre)/i);
});

test("el prompt del cliente tampoco nombra asesores", () => {
  const texto = buildSystemPrompt({
    org: ORG, lead: { id: "l", phone: "573001112233", cita: citaSolicitada }, qualified: true,
    now: { legible: "lunes 9 de noviembre de 2026, 3:20 p. m.", iso: "2026-11-09T15:20:00-05:00" },
  }).map((b) => b.text).join("\n");
  assert.doesNotMatch(texto, /Asesor\s*\d/);
});

// ── 3. Estado de la cita sin ambigüedad, sin promesas de hora ─────────────

test("el prompt dice CONFIRMADA o SOLICITADA y prohíbe prometer cuándo lo contactan", () => {
  const prompt = (cita) => buildSystemPrompt({
    org: ORG, lead: { id: "l", phone: NORHA_TEL, cita }, qualified: false,
    now: { legible: "lunes 9 de noviembre de 2026, 3:20 p. m.", iso: "2026-11-09T15:20:00-05:00" },
    colega: { nombre: "Norha Velez M" },
  }).map((b) => b.text).join("\n");
  const conf = prompt(citaConfirmada);
  assert.match(conf, /VISITA CONFIRMADA/);
  assert.match(conf, /Ref 10505674/);
  assert.doesNotMatch(conf, /SOLICITADA, todav/);
  const sol = prompt(citaSolicitada);
  assert.match(sol, /VISITA SOLICITADA, todavía NO confirmada/);
  assert.match(conf, /Nunca prometas (una hora|cuándo)/i);
});

// ── 2. La confirmación queda en el chat ───────────────────────────────────

test("al confirmar, el mensaje que le llega al colega queda guardado en su chat", async (t) => {
  t.mock.method(leads, "update", async (id, patch) => ({ id, ...patch }));
  const registrados = [];
  const enviados = [];
  const lead = { id: "lead-norha", phone: NORHA_TEL, nombre: "Norha Velez M", source: "colega", cita: { ...citaSolicitada, historial: [] } };
  const r = await confirmar({
    org: ORG, lead, advisor: CATHERINE,
    deps: {
      texto: async (_o, to, txt) => { enviados.push({ to, txt }); return { ok: true, wamid: "w1" }; },
      soloLlamada: async () => false,
      notificar: async () => {},
      registrar: async (l, txt) => { registrados.push({ lead: l.id, txt }); },
    },
  });
  assert.ok(r.ok);
  assert.strictEqual(enviados.length, 1);
  assert.strictEqual(enviados[0].to, NORHA_TEL);
  assert.doesNotMatch(enviados[0].txt, SIN_ALIAS);
  assert.deepStrictEqual(registrados, [{ lead: "lead-norha", txt: enviados[0].txt }]);
});

test("si el mensaje de confirmación no sale, no se guarda como si hubiera salido", async (t) => {
  t.mock.method(leads, "update", async (id, patch) => ({ id, ...patch }));
  const registrados = [];
  const lead = { id: "lead-x", phone: "573001112233", nombre: "X", source: "whatsapp", cita: { ...citaSolicitada, historial: [] } };
  await confirmar({
    org: ORG, lead, advisor: CATHERINE,
    deps: {
      texto: async () => ({ ok: false, error: "fallo" }),
      soloLlamada: async () => false,
      notificar: async () => {},
      registrar: async (l, txt) => { registrados.push(txt); },
    },
  });
  assert.deepStrictEqual(registrados, []);
});

// ── 4. "Quiero hablar con una persona" va a quien tiene la cita ───────────

function mocksContacto(t) {
  const avisos = [];
  t.mock.method(advisors, "findAsesorPrincipalRadar", async () => DAIANA);
  t.mock.method(advisors, "findById", async (_o, id) => (id === "a3" ? CATHERINE : null));
  t.mock.method(groupSignals, "buscarPorTelefono", async () => null);
  t.mock.method(avisarAsesorMod, "avisarAsesor", async (args) => { avisos.push(args); return { ok: true }; });
  return avisos;
}

test("con una visita viva, el pedido de contacto le llega a quien tiene la visita", async (t) => {
  const avisos = mocksContacto(t);
  const ctx = { org: ORG, lead: { id: "lead-norha", phone: "573125802350", nombre: null, cita: citaConfirmada }, colega: { nombre: "Norha Velez M", telefono: "573125802350" } };
  const out = await executeTool("pedir_contacto_asesora", { motivo: "aclarar la visita" }, ctx);
  assert.strictEqual(avisos.length, 1);
  assert.strictEqual(avisos[0].advisor, CATHERINE);
  assert.doesNotMatch(out, SIN_ALIAS);
  assert.match(out, /un asesor de nuestro equipo/);
  assert.doesNotMatch(out, /\bhoy\b/);
});

test("sin visita, va a la asesora principal y Sofi tampoco la nombra", async (t) => {
  const avisos = mocksContacto(t);
  const ctx = { org: ORG, lead: { id: "lead-s", phone: "573125802350", nombre: null, cita: null }, colega: { nombre: "Santiago", telefono: "573125802350" } };
  const out = await executeTool("pedir_contacto_asesora", {}, ctx);
  assert.strictEqual(avisos[0].advisor, DAIANA);
  assert.doesNotMatch(out, SIN_ALIAS);
  const repetido = await executeTool("pedir_contacto_asesora", {}, ctx);
  assert.doesNotMatch(repetido, SIN_ALIAS);
});

// ── 5. Colega sin celular visible ─────────────────────────────────────────

test("colega sin celular visible: el aviso lo dice y Sofi le pide un número", async (t) => {
  const avisos = mocksContacto(t);
  const ctx = { org: ORG, lead: { id: "lead-norha", phone: NORHA_TEL, nombre: null, cita: citaConfirmada }, colega: { nombre: "Norha Velez M" } };
  const out = await executeTool("pedir_contacto_asesora", { motivo: "por llamada" }, ctx);
  assert.doesNotMatch(avisos[0].cuerpo || "", /\+?1622610936270244|CO\.1622/);
  assert.match(avisos[0].cuerpo || "", /sin celular visible/i);
  assert.match(out, /pídele (un|su) (número|celular)/i);
});

test("el aviso de visita no muestra el identificador de WhatsApp como si fuera un teléfono", async () => {
  const llamadas = [];
  await avisarCitaPorConfirmar({
    org: ORG, advisor: CATHERINE, cita: citaSolicitada,
    lead: { id: "lead-norha", phone: NORHA_TEL, nombre: null, source: "colega" },
    deps: { avisar: async (a) => { llamadas.push(a); return { ok: true }; } },
  });
  assert.doesNotMatch(llamadas[0].cuerpo, /CO\.1622|\+CO/);
  assert.match(llamadas[0].cuerpo, /sin celular visible/);
});

test("quienDe: nombre, teléfono legible o 'sin celular visible'", () => {
  const { quienDe } = require("../src/lib/quien-lead");
  assert.strictEqual(quienDe({ nombre: "Norha Velez M", phone: NORHA_TEL }), "Norha Velez M");
  assert.strictEqual(quienDe({ nombre: null, phone: "573001112233" }), "+573001112233");
  assert.strictEqual(quienDe({ nombre: null, phone: NORHA_TEL }), "contacto sin celular visible");
});
