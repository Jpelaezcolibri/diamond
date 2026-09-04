// Mantener abierta la ventana de 24h con la asesora del radar.
//
// EL PROBLEMA (2026-09-04): Meta solo entrega texto libre a quien le escribio
// al negocio en las ultimas 24h. Si Natalia no le escribe a Sofi, su ventana se
// cierra y TODOS los avisos del radar se pierden — ese mismo dia habia mensajes
// represados. Nada de lo que hagamos desde nuestro lado la reabre: solo la
// reabre un mensaje ENTRANTE de ella.
//
// LA IDEA DE JUAN: la linea de Natalia ES la linea vinculada a WAHA, o sea que
// ya la controlamos por API. Que ella misma le escriba a Sofi una vez al dia
// abre la ventana. No es una evasion: es su propia linea de empresa
// escribiendole a su propio bot.
//
// LA GUARDA CRITICA: el truco solo es legitimo mientras la linea que
// controlamos SEA la de ella. Si el numero de la sesion de WAHA no coincide con
// el telefono de la asesora, no se manda nada — mandar desde la linea del radar
// haciendose pasar por otra persona seria algo completamente distinto.

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");

const ventana = require("../src/scheduler/ventana-asesora");
const config = require("../src/config");
const organizations = require("../src/data/organizations");
const advisors = require("../src/data/advisors");
const whatsappGroups = require("../src/data/whatsapp-groups");
const waha = require("../src/lib/waha");
const leads = require("../src/data/leads");
const conversations = require("../src/data/conversations");

const ORG = { id: "org-1", name: "Diamond" };
const NATALIA = { id: "adv-natalia", name: "Natalia", phone: "573001878024" };
const SESION = { nombre: "radar-linea", estado: "activa" };

let originalConfig;

beforeEach(() => {
  originalConfig = { ...config.groups.ventanaAsesora };
  config.groups.ventanaAsesora.enabled = true;
  config.groups.ventanaAsesora.horas = 20;
  process.env.CONTACT_WHATSAPP_NUMBER = "573044653609";
  process.env.RADAR_REVISOR_PHONE = "573001878024";
});

afterEach(() => {
  Object.assign(config.groups.ventanaAsesora, originalConfig);
});

// Todo en orden salvo lo que cada test rompa a proposito.
function escenario(t, { meId = "573001878024@c.us", entrante = false, cuota = null, envios = [] } = {}) {
  t.mock.method(organizations, "listActive", async () => [ORG]);
  t.mock.method(advisors, "findAsesorPrincipalRadar", async () => NATALIA);
  t.mock.method(whatsappGroups, "listSessions", async () => [SESION]);
  t.mock.method(waha, "estadoSesion", async () => ({ status: "WORKING", me: { id: meId } }));
  t.mock.method(waha, "cuotaDeLinea", async () => cuota);
  t.mock.method(leads, "findOrCreate", async () => ({ id: "lead-natalia" }));
  t.mock.method(conversations, "findOrCreate", async () => ({ id: "conv-natalia" }));
  t.mock.method(conversations, "hayMensajeEntranteDespues", async () => entrante);
  t.mock.method(waha, "enviarDm", async (sesion, telefono, texto) => {
    envios.push({ sesion, telefono, texto });
    return { ok: true, wamid: "w1" };
  });
  return envios;
}

// (a) el caso feliz
test("con la ventana por cerrar y todo en orden, la linea de la asesora le escribe a Sofi", async (t) => {
  const envios = escenario(t);

  const r = await ventana.runOnce();

  assert.strictEqual(r.sent, 1);
  assert.strictEqual(envios.length, 1);
  assert.strictEqual(envios[0].sesion, "radar-linea");
  // Al numero OFICIAL de Sofi: es la ventana de Meta la que se quiere abrir.
  assert.strictEqual(envios[0].telefono, "573044653609");
  assert.strictEqual(envios[0].texto, ventana.TEXTO_VENTANA);
});

test("el texto dice que es automatico, para que la asesora no se asuste al verlo en su propio WhatsApp", () => {
  // Lo va a ver en SU telefono como un mensaje que ella no escribio.
  assert.match(ventana.TEXTO_VENTANA, /autom/i);
  assert.match(ventana.TEXTO_VENTANA, /no hace falta responder/i);
});

// (b) ella ya escribio por su cuenta
test("si ella escribio dentro de la ventana, no se manda nada", async (t) => {
  const envios = escenario(t, { entrante: true });

  const r = await ventana.runOnce();

  assert.strictEqual(r.sent, 0);
  assert.strictEqual(envios.length, 0);
  assert.deepStrictEqual(r.resultados, [{ org: "Diamond", resultado: "ventana_abierta" }]);
});

// (c) LA GUARDA CRITICA
test("si la linea de WAHA NO es la de la asesora, no se manda nada", async (t) => {
  // Mandar desde la linea del radar haciendose pasar por ella seria otra cosa
  // completamente distinta a que ella le escriba a su propio bot.
  const envios = escenario(t, { meId: "573999999999@c.us" });

  const r = await ventana.runOnce();

  assert.strictEqual(r.sent, 0);
  assert.strictEqual(envios.length, 0);
  assert.deepStrictEqual(r.resultados, [{ org: "Diamond", resultado: "linea_no_es_de_la_asesora" }]);
});

test("si no se puede leer el numero de la linea, tampoco se manda", async (t) => {
  // Sin poder comprobar la guarda, se falla cerrado.
  const envios = escenario(t);
  t.mock.method(waha, "estadoSesion", async () => ({ status: "WORKING" }));

  const r = await ventana.runOnce();

  assert.strictEqual(r.sent, 0);
  assert.strictEqual(envios.length, 0);
  assert.strictEqual(r.resultados[0].resultado, "linea_no_es_de_la_asesora");
});

// (d) la cuota de la linea
test("con la cuota de WhatsApp agotada no se manda", async (t) => {
  const envios = escenario(t, { cuota: { usados: 300, total: 300, fraccion: 1 } });

  const r = await ventana.runOnce();

  assert.strictEqual(r.sent, 0);
  assert.strictEqual(envios.length, 0);
  assert.deepStrictEqual(r.resultados, [{ org: "Diamond", resultado: "cuota_agotada" }]);
});

test("una cuota que no se pudo leer (null) no frena el envio", async (t) => {
  // Mismo criterio que el resto del radar: null es "no se sabe", no "agotada".
  const envios = escenario(t, { cuota: null });
  assert.strictEqual((await ventana.runOnce()).sent, 1);
  assert.strictEqual(envios.length, 1);
});

test("con cuota parcial se manda", async (t) => {
  const envios = escenario(t, { cuota: { usados: 12, total: 300, fraccion: 0.04 } });
  assert.strictEqual((await ventana.runOnce()).sent, 1);
  assert.strictEqual(envios.length, 1);
});

// (e) el interruptor
test("apagado no hace absolutamente nada", async (t) => {
  const envios = escenario(t);
  config.groups.ventanaAsesora.enabled = false;

  const r = await ventana.runOnce();

  assert.strictEqual(r.sent, 0);
  assert.strictEqual(envios.length, 0);
  assert.deepStrictEqual(r.resultados, []);
});

// (f) sin destino no arranca
test("sin CONTACT_WHATSAPP_NUMBER el worker no arranca", async () => {
  // Igual que el watchdog sin RADAR_WATCHDOG_TO: mejor evidente al arrancar que
  // el dia que haga falta.
  const previo = process.env.CONTACT_WHATSAPP_NUMBER;
  delete process.env.CONTACT_WHATSAPP_NUMBER;
  try {
    assert.strictEqual(ventana.start(), null);
  } finally {
    process.env.CONTACT_WHATSAPP_NUMBER = previo;
  }
});

test("apagado, start() tampoco arranca", () => {
  config.groups.ventanaAsesora.enabled = false;
  assert.strictEqual(ventana.start(), null);
});

// ── Bordes ────────────────────────────────────────────────────────────────

test("sin sesion activa unica no se manda (falla cerrado, como el resto del radar)", async (t) => {
  const envios = escenario(t);
  t.mock.method(whatsappGroups, "listSessions", async () => []);

  const r = await ventana.runOnce();

  assert.strictEqual(r.sent, 0);
  assert.strictEqual(envios.length, 0);
  assert.strictEqual(r.resultados[0].resultado, "sin_sesion");
});

test("sin asesora resuelta no se manda", async (t) => {
  const envios = escenario(t);
  t.mock.method(advisors, "findAsesorPrincipalRadar", async () => null);

  const r = await ventana.runOnce();

  assert.strictEqual(r.sent, 0);
  assert.strictEqual(envios.length, 0);
  assert.strictEqual(r.resultados[0].resultado, "sin_asesora");
});

test("un fallo de WAHA no tumba la corrida", async (t) => {
  // Best-effort como el resto de los schedulers: se anota y se sigue.
  const envios = escenario(t);
  t.mock.method(waha, "enviarDm", async () => {
    throw new Error("WAHA no responde");
  });

  const r = await ventana.runOnce();

  assert.strictEqual(r.sent, 0);
  assert.strictEqual(r.resultados[0].resultado, "error");
  assert.strictEqual(envios.length, 0);
});

test("la ventana se mide con las horas configuradas", async (t) => {
  // El default son 20h: 4h de margen antes de que Meta cierre las 24h.
  const vistos = [];
  escenario(t);
  t.mock.method(conversations, "hayMensajeEntranteDespues", async (convId, iso) => {
    vistos.push(iso);
    return false;
  });

  const antes = Date.now();
  await ventana.runOnce();

  assert.strictEqual(vistos.length, 1);
  const horas = (antes - new Date(vistos[0]).getTime()) / 3600000;
  assert.ok(horas >= 19.9 && horas <= 20.1, `esperaba ~20h de ventana, fue ${horas}`);
});
