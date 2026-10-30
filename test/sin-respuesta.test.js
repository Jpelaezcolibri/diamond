// Nadie queda sin contactar (Juan, 2026-10-29): casos Clara, Luz Stella y Freddy.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const { motivoEscalar, textoParaAsesora } = require("../src/lib/sin-respuesta");
const sched = require("../src/scheduler/sin-respuesta");
const ritmo = require("../src/lib/ritmo-avisos");

// Jueves 2026-10-29, 2:00 p. m. Bogota = 19:00 UTC.
const AHORA = new Date("2026-10-29T19:00:00Z");
const hace = (h) => new Date(AHORA.getTime() - h * 3600 * 1000).toISOString();
const lead = (over = {}) => ({ id: "l1", source: "colega", estado: "nuevo", phone: "573014521622", nombre: "Clara", atencion_pendiente: null, seguimiento: null, ...over });
const u = (h, content = "Hola Sofi, quiero agendar una visita") => ({ role: "user", content, created_at: hace(h) });
const s = (h, content = "¿Te sirve el miércoles 28 a las 10 a. m. o el jueves 29 a las 8 a. m.?") => ({ role: "assistant", content, created_at: hace(h) });

test("Clara: no contestó el seguimiento de Sofi en 3 h -> a la asesora", () => {
  const l = lead({ seguimiento: { t24_sent_at: hace(3) } });
  assert.deepStrictEqual(motivoEscalar({ lead: l, ultimoUsuario: u(7), ultimoMensaje: s(3), ahora: AHORA }), { motivo: "no_contesto" });
  const temprano = lead({ seguimiento: { t24_sent_at: hace(2) } });
  assert.strictEqual(motivoEscalar({ lead: temprano, ultimoUsuario: u(7), ultimoMensaje: s(2), ahora: AHORA }), null);
});

test("un seguimiento de un episodio viejo no cuenta para el nuevo", () => {
  const l = lead({ seguimiento: { t24_sent_at: hace(30) } });
  // Escribió hace 4 h y Sofi contestó: todavía le toca el seguimiento de Sofi.
  assert.strictEqual(motivoEscalar({ lead: l, ultimoUsuario: u(4), ultimoMensaje: s(4), ahora: AHORA }), null);
});

test("si Sofi no alcanzó a hacer el seguimiento, pasa cuando se cierra la ventana; antes, le toca a Sofi", () => {
  assert.deepStrictEqual(motivoEscalar({ lead: lead(), ultimoUsuario: u(24), ultimoMensaje: s(24), ahora: AHORA }), { motivo: "sin_seguimiento" });
  assert.strictEqual(motivoEscalar({ lead: lead(), ultimoUsuario: u(10), ultimoMensaje: s(10), ahora: AHORA }), null);
});

test("Luz Stella: nota de voz sin respuesta escrita -> a la asesora a las 2 h", () => {
  const voz = u(2, "[Nota de voz recibida]");
  assert.deepStrictEqual(motivoEscalar({ lead: lead(), ultimoUsuario: voz, ultimoMensaje: s(2, "por acá no puedo escuchar audios"), ahora: AHORA }), { motivo: "nota_de_voz" });
});

test("Freddy: pidió asesor y en 2 h nadie le escribió", () => {
  const l = lead({ atencion_pendiente: "pide_asesor", atencion_desde: hace(2) });
  assert.deepStrictEqual(motivoEscalar({ lead: l, ultimoUsuario: u(2, "Ok"), ultimoMensaje: s(2), ahora: AHORA }), { motivo: "pide_asesor" });
});

test("una sola vez por episodio", () => {
  const l = lead({ seguimiento: { t24_sent_at: hace(5), asesor_at: hace(1) } });
  assert.strictEqual(motivoEscalar({ lead: l, ultimoUsuario: u(8), ultimoMensaje: s(5), ahora: AHORA }), null);
});

test("no escala lo que atiende otro carril, lo cerrado, lo viejo ni a quien espera respuesta de Sofi", () => {
  const base = { ultimoUsuario: u(30), ultimoMensaje: s(30), ahora: AHORA };
  assert.strictEqual(motivoEscalar({ ...base, lead: lead({ atencion_pendiente: "pregunta" }) }), null);
  assert.strictEqual(motivoEscalar({ ...base, lead: lead({ estado: "cerrado_perdido" }) }), null);
  assert.strictEqual(motivoEscalar({ ...base, lead: lead({ source: "asesor" }) }), null);
  assert.strictEqual(motivoEscalar({ lead: lead(), ultimoUsuario: u(60), ultimoMensaje: s(60), ahora: AHORA }), null);
  assert.strictEqual(motivoEscalar({ lead: lead(), ultimoUsuario: u(8), ultimoMensaje: u(8), ahora: AHORA }), null);
});

test("una respuesta automática de otra inmobiliaria no pasa a la asesora (Propiedades Carva)", () => {
  const auto = u(8, "¡Gracias por contactarnos! Le informamos que en este momento no nos encontramos en nuestro horario de atención. Tan pronto retomemos la asesora encargada se colocará en contacto con usted.");
  assert.strictEqual(motivoEscalar({ lead: lead(), ultimoUsuario: auto, ultimoMensaje: s(8), ahora: AHORA }), null);
});

test("el texto para la asesora trae el contacto y lo que quedó pendiente", () => {
  const t = textoParaAsesora({ lead: lead(), motivo: "no_contesto", ultimoUsuario: u(7), ultimoSofi: s(3), crmUrl: "https://crm.x/inbox/c1" });
  assert.match(t, /Hay que contactar a Clara\* \(colega\)/);
  assert.match(t, /wa\.me\/573014521622/);
  assert.match(t, /miércoles 28/);
  assert.match(t, /https:\/\/crm\.x\/inbox\/c1/);
  const sinTel = textoParaAsesora({ lead: lead({ phone: "CO.3468246810013101" }), motivo: "no_contesto", ultimoUsuario: u(7), ultimoSofi: s(3) });
  assert.match(sinTel, /No tenemos su número/);
  assert.doesNotMatch(sinTel, /wa\.me/);
});

// --- scheduler ---
const A1 = { id: "a1", name: "Daiana", phone: "573011880668" };
const A2 = { id: "a2", name: "Claudia", phone: "573003418113" };
let log;
const deps = (over = {}) => ({
  orgs: async () => [{ id: "org-1", name: "Diamond" }],
  candidatos: async () => [
    { id: "c1", leads: lead({ seguimiento: { t24_sent_at: hace(3) } }) },
    { id: "c2", leads: lead({ id: "l2", nombre: "Luz Stella", phone: "573105140640" }) },
  ],
  mensajes: async (id) => (id === "c1" ? [u(7), s(3)] : [s(3, "hola"), u(2, "[Nota de voz recibida]"), s(2, "no puedo escuchar audios")]),
  ciclo: async () => [A1, A2],
  conVentana: async () => [A1],
  claim: async () => ({ asesor_at: AHORA.toISOString() }),
  esAgente: async () => false,
  soloLlamada: async () => false,
  nombreColega: async () => null,
  enviar: async (_o, tel, texto) => { log.push({ wa: tel, texto }); return { ok: true }; },
  avisarAsesor: async (a) => { log.push({ campana: a.advisor.id, motivo: a.motivo, whatsapp: a.whatsapp }); return { ok: true }; },
  crmUrl: null,
  ...over,
});

beforeEach(() => { log = []; ritmo._reset(); });

// Juan, 2026-10-30: "si son muchos, que se haga de a uno".
test("de a uno: un caso por asesora por vuelta, el otro espera; y queda en el CRM", async () => {
  const r = await sched.runOnce({ ahora: AHORA, deps: deps() });
  assert.deepStrictEqual([r.escalados, r.enviados, r.esperando], [1, 1, 1]);
  const wa = log.filter((x) => x.wa);
  assert.strictEqual(wa.length, 1);
  assert.strictEqual(wa[0].wa, "573011880668");
  assert.match(wa[0].texto, /Clara/);
  assert.doesNotMatch(wa[0].texto, /Luz Stella/);
  assert.deepStrictEqual(log.filter((x) => x.campana).map((x) => [x.campana, x.motivo, x.whatsapp]), [["a1", "sin_respuesta", false]]);
});

test("si ninguna asesora tiene la ventana abierta: campana + aviso_app, sin texto libre", async () => {
  const r = await sched.runOnce({ ahora: AHORA, deps: deps({ conVentana: async () => [] }) });
  assert.strictEqual(r.soloCampana, 1);
  assert.ok(!log.some((x) => x.wa));
  assert.ok(log.filter((x) => x.campana).every((x) => x.whatsapp === true));
});

test("si otro tick ya lo tomó, no se repite", async () => {
  const r = await sched.runOnce({ ahora: AHORA, deps: deps({ claim: async () => null }) });
  assert.strictEqual(r.escalados, 0);
  assert.strictEqual(log.length, 0);
});

test("con el freno de ritmo cerrado espera a la próxima vuelta sin marcar nada", async () => {
  ritmo.registrarEnvio("a1", AHORA.getTime() - 60 * 1000);
  let claims = 0;
  const r = await sched.runOnce({ ahora: AHORA, deps: deps({ claim: async () => { claims++; return {}; } }) });
  assert.deepStrictEqual([r.escalados, r.esperando, claims], [0, 2, 0]);
});

test("a un agente automático de otra inmobiliaria no se le pasa", async () => {
  const r = await sched.runOnce({ ahora: AHORA, deps: deps({ esAgente: async () => true }) });
  assert.strictEqual(r.escalados, 0);
});

test("de noche no corre", async () => {
  const r = await sched.runOnce({ ahora: new Date("2026-10-30T03:00:00Z"), deps: deps() });
  assert.strictEqual(r.escalados, 0);
});
