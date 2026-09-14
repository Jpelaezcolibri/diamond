// Mensajes repetidos a la asesora por el mismo colega (Juan, 2026-09-14: "me
// dicen que llegan muchos mensajes para el mismo colega").
//
// Medido del 07 al 14-sep, 13 casos. Cinco causas, cinco arreglos:
//   1. La bandeja tomaba una señal que vivo.js#asistir todavia estaba
//      avisando: Carmen Arbelaez recibio dos avisos identicos a las 21:00:37.
//   2. La bandeja tomaba una señal con el DM al colega en camino: aviso y DM
//      en el mismo minuto (Jaime, Claudia Velez, Lu Vallejo, Margarita).
//   3. El post-DM salia sin mirar el freno de ritmo: Jaime publico 8 pedidos
//      en 2 minutos y la asesora recibio 2 post-DM y 1 aviso en 37 segundos.
//      (Ese caso se prueba en test/group-asistido.test.js; aca, la bandeja que
//      entrega lo que quedo en cola.)
//   4. Un pedido republicado caia en ya_se_le_mando y producia otro aviso.
//   5. "🔔 Pedido directo de un colega" salia en cada mensaje del colega:
//      Adriana recibio dos con 32 segundos de diferencia.

// tools.js lee RADAR_REVISOR_PHONE al cargar, y se carga de rebote con el
// canal de WhatsApp (whatsapp.js -> engine.js -> tools.js).
process.env.RADAR_REVISOR_PHONE = "573011880668";

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const digest = require("../src/groups/digest-avisos");
const colaPostDm = require("../src/groups/cola-post-dm");
const ritmo = require("../src/lib/ritmo-avisos");
const revalidar = require("../src/groups/revalidar");
const advisors = require("../src/data/advisors");
const groupSignals = require("../src/data/group-signals");
const mandatosData = require("../src/data/mandatos");
const whatsappGroups = require("../src/data/whatsapp-groups");
const leads = require("../src/data/leads");
const conversations = require("../src/data/conversations");
const canalWhatsapp = require("../src/channels/whatsapp");
const mensajeAsesor = require("../src/lib/mensaje-asesor");
const avisosSalida = require("../src/scheduler/avisos-salida");
const tools = require("../src/agent/tools");

const ORG = { id: "org-rep", name: "Diamond" };
const DAIANA = { id: "adv-daiana", name: "Daiana Zea", phone: "573011880668" };
const REV = { es_pedido_real: true, sirve_alguna: true, refs_utiles: ["9780079"], refs_dudosas: [], confianza: 0.9, por_que: "Calza." };

beforeEach(() => {
  ritmo._reset();
  colaPostDm._reset();
  tools._resetAvisosDemandaColega();
});

// La bandeja con todo lo de la base simulado. Devuelve lo que consulto y lo
// que mando.
function bandeja(t, { senales = [], envio = { ok: true, wamid: "wm-1" } } = {}) {
  const r = { consulta: null, enviados: [] };
  t.mock.method(advisors, "findAsesorPrincipalRadar", async () => DAIANA);
  t.mock.method(groupSignals, "aprobadasSinAvisar", async (orgId, opts) => {
    r.consulta = opts;
    return senales;
  });
  t.mock.method(mandatosData, "pendientes", async () => []);
  t.mock.method(mandatosData, "listarActivos", async () => []);
  t.mock.method(whatsappGroups, "listGroups", async () => []);
  t.mock.method(whatsappGroups, "listSessions", async () => []);
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async (org, tel, texto) => {
    r.enviados.push({ tel, texto });
    return envio;
  });
  return r;
}

const postDm = (colega, ref, extra = {}) => ({
  texto: `✅ Ya le mandé por privado a ${colega}: Ref ${ref}`,
  colega, enviadas: [ref], dudosas: 1, faltantes: 0, link: null, ...extra,
});

// ── Causas 1 y 2: la señal en vuelo ───────────────────────────────────────

test("la bandeja no toma señales recien creadas: asistir todavia las esta avisando", async (t) => {
  const r = bandeja(t);
  const ahora = Date.parse("2026-09-14T21:00:37Z");
  await avisosSalida.procesarOrg(ORG, ahora);

  assert.ok(avisosSalida.GRACIA_MIN >= 2, "un DM partido tarda decenas de segundos en salir");
  assert.strictEqual(r.consulta.hastaIso, new Date(ahora - avisosSalida.GRACIA_MIN * 60 * 1000).toISOString());
});

test("la consulta en memoria respeta el tope: la señal de hace 30 s queda afuera, la de hace 5 min entra", async () => {
  const memory = require("../src/data/memory");
  const previas = memory.groupSignals;
  const ahora = Date.now();
  memory.groupSignals = [
    { id: "nueva", org_id: ORG.id, clase: "demanda", revalidacion: REV, created_at: new Date(ahora - 30 * 1000).toISOString() },
    { id: "vieja", org_id: ORG.id, clase: "demanda", revalidacion: REV, created_at: new Date(ahora - 5 * 60 * 1000).toISOString() },
  ];
  try {
    // Solo el camino en memoria: con Supabase configurada la consulta real
    // va por .lte("created_at"), que no se puede ejercitar sin la base.
    if (require("../src/data/supabase")) return;
    const hastaIso = new Date(ahora - 3 * 60 * 1000).toISOString();
    const r = await groupSignals.aprobadasSinAvisar(ORG.id, { desdeIso: new Date(0).toISOString(), hastaIso });
    assert.deepStrictEqual(r.map((s) => s.id), ["vieja"]);
  } finally {
    memory.groupSignals = previas;
  }
});

// ── Causa 4: el pedido republicado ─────────────────────────────────────────

test("un pedido que ya se le mando al colega no sale por la bandeja", async (t) => {
  assert.ok(revalidar.apruebaAviso(REV), "control: sin el motivo, este veredicto SI se avisaria");
  const r = bandeja(t, { senales: [{ id: "s1", clase: "demanda", revalidacion: REV, politica_motivo: "ya_se_le_mando" }] });

  const salida = await avisosSalida.procesarOrg(ORG, Date.now());
  assert.strictEqual(salida, null);
  assert.strictEqual(r.enviados.length, 0);
});

// ── Causa 3: los post-DM que el freno retuvo ──────────────────────────────

test("un post-DM retenido sale solo, con su texto completo, y deja la cola vacia", async (t) => {
  const r = bandeja(t);
  colaPostDm.encolar(ORG.id, DAIANA.id, postDm("Jaime", "9780079"));
  const ahora = Date.now();

  const salida = await avisosSalida.procesarOrg(ORG, ahora);

  assert.strictEqual(salida.ok, true);
  assert.strictEqual(r.enviados.length, 1);
  assert.strictEqual(r.enviados[0].texto, "✅ Ya le mandé por privado a Jaime: Ref 9780079");
  assert.strictEqual(colaPostDm.ver(ORG.id, DAIANA.id).length, 0);
  assert.strictEqual(ritmo.puedeEnviar(DAIANA.id, ahora), false, "y cuenta para el freno");
});

test("varios post-DM salen en UN mensaje, agrupados por colega", async (t) => {
  const r = bandeja(t);
  colaPostDm.encolar(ORG.id, DAIANA.id, postDm("Jaime", "9780079"));
  colaPostDm.encolar(ORG.id, DAIANA.id, postDm("Jaime", "9800000", { dudosas: 0, faltantes: 1 }));
  colaPostDm.encolar(ORG.id, DAIANA.id, postDm("Lu Vallejo", "10077063"));

  await avisosSalida.procesarOrg(ORG, Date.now());

  assert.strictEqual(r.enviados.length, 1, "un solo mensaje");
  const texto = r.enviados[0].texto;
  assert.match(texto, /tenés 3 cosas nuevas/);
  assert.match(texto, /YA LES RESPONDÍ POR PRIVADO \(3\)/);
  assert.match(texto, /Jaime \(2 pedidos\) — le mandé Ref 9780079, Ref 9800000/);
  assert.match(texto, /1 no le llegaron, mandáselas vos · 1 para revisar/);
  assert.match(texto, /Lu Vallejo — le mandé Ref 10077063/);
  assert.strictEqual(colaPostDm.ver(ORG.id, DAIANA.id).length, 0);
});

test("si la entrega falla, el post-DM se queda en la cola para la proxima pasada", async (t) => {
  const r = bandeja(t, { envio: { ok: false, error: "timeout" } });
  colaPostDm.encolar(ORG.id, DAIANA.id, postDm("Jaime", "9780079"));

  const salida = await avisosSalida.procesarOrg(ORG, Date.now());

  assert.strictEqual(salida.ok, false);
  assert.strictEqual(r.enviados.length, 1);
  assert.strictEqual(colaPostDm.ver(ORG.id, DAIANA.id).length, 1);
});

test("con el freno cerrado la bandeja no toca la cola", async (t) => {
  const r = bandeja(t);
  const ahora = Date.now();
  ritmo.registrarEnvio(DAIANA.id, ahora);
  colaPostDm.encolar(ORG.id, DAIANA.id, postDm("Jaime", "9780079"));

  assert.strictEqual(await avisosSalida.procesarOrg(ORG, ahora), null);
  assert.strictEqual(r.enviados.length, 0);
  assert.strictEqual(colaPostDm.ver(ORG.id, DAIANA.id).length, 1);
});

test("el digest cuenta los post-DM junto con los pedidos y las ofertas", () => {
  const texto = digest.construir(
    "Daiana",
    [{ id: "p1", colega: "Carmen Arbelaez", operacion: "venta", tipo: "apartamento", zona: "Envigado", utiles: 1, dudosas: 0 }],
    [],
    [{ colega: "Jaime", enviadas: ["9780079"], dudosas: 1, faltantes: 0, link: "https://crm.x/aviso/abc" }]
  );
  assert.match(texto, /tenés 2 cosas nuevas/);
  assert.match(texto, /PEDIDOS DE COLEGAS \(1\)/);
  assert.match(texto, /YA LES RESPONDÍ POR PRIVADO \(1\)/);
  assert.match(texto, /👉 https:\/\/crm\.x\/aviso\/abc/);
});

// ── El candado de envios simultaneos (causa 1, por debajo de todo) ────────

function canalSimulado(t, resultado = { ok: true, wamid: "wm-real" }) {
  const salidas = [];
  t.mock.method(advisors, "findByPhone", async () => null);
  t.mock.method(leads, "findOrCreate", async () => ({ id: "lead-asesora" }));
  t.mock.method(conversations, "findOrCreate", async () => ({ id: "conv-asesora" }));
  t.mock.method(conversations, "ultimosSalientes", async () => []);
  t.mock.method(conversations, "appendMessage", async () => ({ id: `msg-${salidas.length}` }));
  t.mock.method(conversations, "setDelivery", async () => {});
  t.mock.method(conversations, "setWaMessageId", async () => {});
  t.mock.method(canalWhatsapp, "sendWhatsApp", async (org, to, texto) => {
    salidas.push({ to, texto });
    await new Promise((r) => setTimeout(r, 20));
    return resultado;
  });
  return salidas;
}

test("dos envios IDENTICOS al mismo tiempo salen una sola vez", async (t) => {
  const salidas = canalSimulado(t);
  const [a, b] = await Promise.all([
    mensajeAsesor.enviarYRegistrar(ORG, DAIANA.phone, "🎯 Oportunidad: Carmen Arbelaez"),
    mensajeAsesor.enviarYRegistrar(ORG, DAIANA.phone, "🎯 Oportunidad: Carmen Arbelaez"),
  ]);
  assert.strictEqual(salidas.length, 1);
  assert.strictEqual(a.ok, true);
  assert.strictEqual(b.ok, true);
  assert.strictEqual(b.duplicado, true);
});

test("si el primero falla, el repetido tambien dice que fallo: nadie marca como avisado lo que no llego", async (t) => {
  const salidas = canalSimulado(t, { ok: false, error: "timeout" });
  const [a, b] = await Promise.all([
    mensajeAsesor.enviarYRegistrar(ORG, DAIANA.phone, "🎯 Oportunidad: X"),
    mensajeAsesor.enviarYRegistrar(ORG, DAIANA.phone, "🎯 Oportunidad: X"),
  ]);
  assert.strictEqual(salidas.length, 1);
  assert.strictEqual(a.ok, false);
  assert.strictEqual(b.ok, false);
});

test("textos distintos al mismo tiempo salen los dos: el candado es por texto, no por asesora", async (t) => {
  const salidas = canalSimulado(t);
  await Promise.all([
    mensajeAsesor.enviarYRegistrar(ORG, DAIANA.phone, "🎯 Oportunidad: A"),
    mensajeAsesor.enviarYRegistrar(ORG, DAIANA.phone, "🎯 Oportunidad: B"),
  ]);
  assert.strictEqual(salidas.length, 2);
});

// ── Causa 5: "Pedido directo de un colega" ────────────────────────────────

function avisoDirecto(t, resultado = { ok: true, wamid: "wm" }) {
  const enviados = [];
  t.mock.method(advisors, "findByPhone", async () => DAIANA);
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async (org, tel, texto) => {
    enviados.push({ tel, texto });
    return resultado;
  });
  return enviados;
}

const pedidoDirecto = (leadId, notas) => [
  { org: ORG, lead: { id: leadId } },
  { contacto: "Adriana", contactoTelefono: null, matches: [], clasificado: { tipo: "apartamento", zona: "Envigado", notas } },
];

test("el mismo colega sumando detalle en un segundo mensaje: la asesora recibe UN aviso", async (t) => {
  const enviados = avisoDirecto(t);
  await tools.avisarDemandaColegaInmediata(...pedidoDirecto("lead-adriana", "3 alcobas"));
  await tools.avisarDemandaColegaInmediata(...pedidoDirecto("lead-adriana", "3 alcobas, con parqueadero"));
  assert.strictEqual(enviados.length, 1);
  assert.match(enviados[0].texto, /Pedido directo de un colega/);
});

test("otro colega en el mismo rato si genera su aviso", async (t) => {
  const enviados = avisoDirecto(t);
  await tools.avisarDemandaColegaInmediata(...pedidoDirecto("lead-adriana", "a"));
  await tools.avisarDemandaColegaInmediata(...pedidoDirecto("lead-otro", "b"));
  assert.strictEqual(enviados.length, 2);
});

test("si el aviso no salio, el siguiente pedido del colega lo vuelve a intentar", async (t) => {
  const enviados = avisoDirecto(t, { ok: false, error: "ventana cerrada" });
  await tools.avisarDemandaColegaInmediata(...pedidoDirecto("lead-adriana", "a"));
  await tools.avisarDemandaColegaInmediata(...pedidoDirecto("lead-adriana", "b"));
  assert.strictEqual(enviados.length, 2);
});
