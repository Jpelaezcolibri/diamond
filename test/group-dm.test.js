// Inbox pasivo de la linea vinculada (Juan, 2026-08-21): "necesito hacer un
// cruce de datos de cuales mensajes respondio el bot y cuales el colega de
// regreso le respondio al numero de natalia... que me alerte cuando se
// concreta una fecha y una hora de visita". Ampliado el mismo dia: "solo
// quiero que me alerte de los que llegan directamente de los colegas, que
// los guarde todos pero que solo me alerte... de todo lo que de a entender
// que hay una posible venta".
//
// NUNCA RESPONDE NADA — es lectura y alerta, no conversacion. Eso se prueba
// aparte, por ausencia: ningun test de este archivo simula un envio al
// colega porque el codigo no tiene ninguna via para hacerlo.

const { test } = require("node:test");
const assert = require("node:assert");
const { _setClientForTests } = require("../src/lib/anthropic");

// RADAR_VISITAS_ALERTA_TO se lee UNA vez al cargar el modulo (mismo patron
// que RADAR_REVISOR_PHONE en src/groups/vivo.js): tiene que estar puesta
// ANTES del require, no en un beforeEach.
process.env.RADAR_VISITAS_ALERTA_TO = "573000000000";

const dm = require("../src/groups/dm");
const groupSignals = require("../src/data/group-signals");
const lineaDm = require("../src/data/linea-dm");
const mensajeAsesor = require("../src/lib/mensaje-asesor");

const ORG = { id: "org-1" };
const mensaje = (extra = {}) => ({
  waMessageId: "wamid-1", sesion: "RADA-NATALIA", remitenteTelefono: "573001112222",
  remitenteNombre: "Felipe Velez", texto: "hola", fechaMensaje: "2026-08-21T10:00:00Z", ...extra,
});

function mockVeredicto(t, veredicto) {
  _setClientForTests({
    messages: {
      create: async () => ({ content: [{ type: "text", text: JSON.stringify(veredicto) }], usage: {} }),
    },
  });
  t.after(() => _setClientForTests(null));
}

function veredicto(extra = {}) {
  return { hay_avance: false, tipo: "ninguno", fecha_hora_iso: "", resumen: "", confianza: 0.9, ...extra };
}

test.beforeEach((t) => {
  t.mock.method(groupSignals, "buscarPorTelefono", async () => null);
  t.mock.method(lineaDm, "create", async () => ({ mensaje: { id: "dm-1", created_at: "2026-08-21T10:00:00Z" }, duplicado: false }));
  t.mock.method(lineaDm, "historialDe", async () => []);
  t.mock.method(lineaDm, "guardarClasificacion", async () => true);
  t.mock.method(lineaDm, "marcarAlertado", async () => true);
  t.mock.method(lineaDm, "ultimaCitaAlertada", async () => null);
});

test("un mensaje duplicado no se vuelve a procesar", async (t) => {
  t.mock.method(lineaDm, "create", async () => ({ mensaje: null, duplicado: true }));
  const r = await dm.procesarMensaje(ORG, mensaje());
  assert.strictEqual(r.resultado, "duplicado");
});

test("sin la migracion corrida, se degrada sin reventar", async (t) => {
  t.mock.method(lineaDm, "create", async () => ({ mensaje: null, duplicado: false }));
  const r = await dm.procesarMensaje(ORG, mensaje());
  assert.strictEqual(r.resultado, "sin_tabla");
});

test("un 'gracias' sin mas contexto NO genera alerta", async (t) => {
  mockVeredicto(t, veredicto({ hay_avance: false, tipo: "ninguno" }));
  let seEnvio = false;
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async () => { seEnvio = true; return { ok: true }; });

  const r = await dm.procesarMensaje(ORG, mensaje({ texto: "gracias" }));

  assert.strictEqual(r.resultado, "sin_avance");
  assert.strictEqual(seEnvio, false);
});

test("una cita CONFIRMADA con fecha y hora SI alerta", async (t) => {
  mockVeredicto(t, veredicto({
    hay_avance: true, tipo: "cita_confirmada", fecha_hora_iso: "2026-08-25T15:00:00-05:00",
    resumen: "Quedaron el lunes a las 3pm",
  }));
  let recibido = null;
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async (org, telefono, texto) => { recibido = { telefono, texto }; return { ok: true }; });

  const r = await dm.procesarMensaje(ORG, mensaje());

  assert.strictEqual(r.resultado, "alertado");
  assert.strictEqual(recibido.telefono, "573000000000");
  assert.match(recibido.texto, /Cita confirmada/);
  assert.match(recibido.texto, /Felipe Velez/);
});

// "solo quiero que me alerte... de todo lo que de a entender que hay una
// posible venta" — no hace falta fecha exacta, "agendando" o "interes
// avanzado" tambien avisan.
test("'agendando' sin fecha exacta TAMBIEN alerta — no hace falta una cita cerrada", async (t) => {
  mockVeredicto(t, veredicto({ hay_avance: true, tipo: "agendando", resumen: "Esta coordinando dia con su cliente" }));
  let seEnvio = false;
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async () => { seEnvio = true; return { ok: true }; });

  const r = await dm.procesarMensaje(ORG, mensaje());

  assert.strictEqual(r.resultado, "alertado");
  assert.strictEqual(seEnvio, true);
});

test("'interes_avanzado' (posible venta sin agenda) TAMBIEN alerta", async (t) => {
  mockVeredicto(t, veredicto({ hay_avance: true, tipo: "interes_avanzado", resumen: "A su cliente le encanto" }));
  let seEnvio = false;
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async () => { seEnvio = true; return { ok: true }; });

  const r = await dm.procesarMensaje(ORG, mensaje());
  assert.strictEqual(seEnvio, true);
});

test("sin RADAR_VISITAS_ALERTA_TO configurado, se clasifica pero no se avisa a nadie", async (t) => {
  // El const se lee al cargar el modulo: para probar "sin variable" hay que
  // recargarlo en frio, sin la variable, y despues restaurar todo.
  const ruta = require.resolve("../src/groups/dm");
  const previo = process.env.RADAR_VISITAS_ALERTA_TO;
  delete process.env.RADAR_VISITAS_ALERTA_TO;
  delete require.cache[ruta];
  const dmSinDestinatario = require("../src/groups/dm");

  mockVeredicto(t, veredicto({ hay_avance: true, tipo: "cita_confirmada", fecha_hora_iso: "2026-08-25T15:00:00-05:00" }));
  let seEnvio = false;
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async () => { seEnvio = true; return { ok: true }; });

  const r = await dmSinDestinatario.procesarMensaje(ORG, mensaje());

  process.env.RADAR_VISITAS_ALERTA_TO = previo;
  delete require.cache[ruta];
  require("../src/groups/dm"); // vuelve a dejar el modulo cacheado con la variable puesta

  assert.strictEqual(r.resultado, "sin_destinatario");
  assert.strictEqual(seEnvio, false);
});

test("el MISMO avance no se re-alerta en cada mensaje siguiente del hilo", async (t) => {
  mockVeredicto(t, veredicto({ hay_avance: true, tipo: "cita_confirmada", fecha_hora_iso: "2026-08-25T15:00:00-05:00" }));
  t.mock.method(lineaDm, "ultimaCitaAlertada", async () => "2026-08-25T15:00:00-05:00");
  let seEnvio = false;
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async () => { seEnvio = true; return { ok: true }; });

  const r = await dm.procesarMensaje(ORG, mensaje());

  assert.strictEqual(r.resultado, "avance_ya_alertado");
  assert.strictEqual(seEnvio, false);
});

test("una REAGENDA (fecha distinta a la ya alertada) SI vuelve a avisar", async (t) => {
  mockVeredicto(t, veredicto({ hay_avance: true, tipo: "cita_confirmada", fecha_hora_iso: "2026-08-26T10:00:00-05:00" }));
  t.mock.method(lineaDm, "ultimaCitaAlertada", async () => "2026-08-25T15:00:00-05:00"); // fecha anterior, distinta
  let seEnvio = false;
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async () => { seEnvio = true; return { ok: true }; });

  const r = await dm.procesarMensaje(ORG, mensaje());

  assert.strictEqual(r.resultado, "alertado");
  assert.strictEqual(seEnvio, true);
});

test("si el envio de la alerta falla, no se marca como alertado", async (t) => {
  mockVeredicto(t, veredicto({ hay_avance: true, tipo: "cita_confirmada", fecha_hora_iso: "2026-08-25T15:00:00-05:00" }));
  let seMarco = false;
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async () => ({ ok: false, error: "timeout" }));
  t.mock.method(lineaDm, "marcarAlertado", async () => { seMarco = true; return true; });

  const r = await dm.procesarMensaje(ORG, mensaje());

  assert.strictEqual(r.resultado, "error_envio");
  assert.strictEqual(seMarco, false);
});

test("si el clasificador falla, se guarda el mensaje pero no se alerta nada", async (t) => {
  _setClientForTests({ messages: { create: async () => { throw new Error("caido"); } } });
  t.after(() => _setClientForTests(null));
  let seEnvio = false;
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async () => { seEnvio = true; return { ok: true }; });

  const r = await dm.procesarMensaje(ORG, mensaje());

  assert.strictEqual(r.resultado, "sin_clasificar");
  assert.strictEqual(seEnvio, false);
});

test("el pedido de grupo del mismo telefono viaja en la alerta cuando se resuelve", async (t) => {
  t.mock.method(groupSignals, "buscarPorTelefono", async () => ({ id: "sig-1", texto_original: "Busco apto en Llanogrande" }));
  mockVeredicto(t, veredicto({ hay_avance: true, tipo: "cita_confirmada", fecha_hora_iso: "2026-08-25T15:00:00-05:00" }));
  let recibido = null;
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async (org, telefono, texto) => { recibido = texto; return { ok: true }; });

  await dm.procesarMensaje(ORG, mensaje());

  assert.match(recibido, /Pedido original/);
  assert.match(recibido, /Llanogrande/);
});

test("clasificarAvance sin mensajes no llama a la IA", async () => {
  const r = await dm.clasificarAvance([], new Date());
  assert.strictEqual(r, null);
});
