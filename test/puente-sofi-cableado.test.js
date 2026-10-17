// El puente probado por su cuenta no alcanza: tiene que correr DE VERDAD
// cuando entra la respuesta del colega por la linea (dm.procesarMensaje), y
// el historial de linea_dm tiene que traer senal_id para que el "una sola vez"
// funcione contra la base real. Leccion de linea-dm-puerta-lid-cerrada: la
// suite quedo verde 18 dias con el cableado roto.

const { test } = require("node:test");
const assert = require("node:assert");
const path = require("path");

process.env.CONTACT_WHATSAPP_NUMBER = "573009998877";
delete process.env.RADAR_DM_CLASIFICAR; // fase 1: solo guardar

const dm = require("../src/groups/dm");
const groupSignals = require("../src/data/group-signals");
const lineaDm = require("../src/data/linea-dm");
const envioColega = require("../src/groups/envio-colega");
const advisors = require("../src/data/advisors");
const notificar = require("../src/notifications/notificar");

const ORG = { id: "org-1", contact_whatsapp_number: "573009998877" };
const mensaje = {
  waMessageId: "wamid-1", sesion: "DaianaDiamond", remitenteId: "84134751940861@lid",
  remitenteTelefono: null, remitenteLid: "84134751940861@lid", remitenteNombre: "Isabel Restrepo",
  texto: "Necesito que me valides cuales tienen 2 alcobas con baño", fechaMensaje: "2026-10-17T00:41:20Z",
};

function preparar(t, { señal, historial }) {
  const enviados = [];
  t.mock.method(groupSignals, "buscarPorLid", async () => señal);
  t.mock.method(groupSignals, "buscarPorTelefono", async () => null);
  t.mock.method(lineaDm, "create", async () => ({ mensaje: { id: "dm-1", created_at: "2026-10-17T00:41:22Z" }, duplicado: false }));
  t.mock.method(lineaDm, "historialDe", async () => historial);
  t.mock.method(envioColega, "enviarAlColega", async (args) => { enviados.push(args); return { ok: true }; });
  t.mock.method(advisors, "findAsesorPrincipalRadar", async () => ({ id: "adv-daiana" }));
  t.mock.method(notificar, "notificar", async () => ({ ok: true }));
  return enviados;
}

test("la respuesta de un colega a un DM del radar tiende el puente a Sofi", async (t) => {
  const enviados = preparar(t, {
    señal: { id: "sig-1", autor_nombre: "Isabel Restrepo", codigo_colega: "64YV" },
    historial: [{ id: "dm-1", senal_id: "sig-1" }],
  });
  const r = await dm.procesarMensaje(ORG, mensaje);
  assert.strictEqual(r.resultado, "guardado");
  assert.strictEqual(enviados.length, 1);
  assert.match(enviados[0].mensajes[0].texto, /Sofi/);
  assert.strictEqual(enviados[0].lid, "84134751940861@lid");
});

test("un mensaje sin pedido ligado se guarda y no se contesta", async (t) => {
  const enviados = preparar(t, { señal: null, historial: [] });
  const r = await dm.procesarMensaje(ORG, mensaje);
  assert.strictEqual(r.resultado, "guardado");
  assert.strictEqual(enviados.length, 0);
});

test("si el puente revienta, el mensaje igual queda guardado", async (t) => {
  preparar(t, { señal: { id: "sig-1", autor_nombre: "Isabel", codigo_colega: "64YV" }, historial: [{ id: "dm-1", senal_id: "sig-1" }] });
  t.mock.method(envioColega, "enviarAlColega", async () => { throw new Error("WAHA caido"); });
  const r = await dm.procesarMensaje(ORG, mensaje);
  assert.strictEqual(r.resultado, "guardado");
});

test("historialDe pide senal_id a la base (sin eso el 'una sola vez' no funciona)", async () => {
  let columnas = null;
  const q = {
    select(c) { columnas = c; return q; }, eq() { return q; }, order() { return q; }, limit() { return q; },
    then(resolve) { resolve({ data: [], error: null }); },
  };
  const rutaSupabase = path.resolve(__dirname, "../src/data/supabase.js");
  const rutaLinea = path.resolve(__dirname, "../src/data/linea-dm.js");
  const previoSupabase = require.cache[rutaSupabase];
  delete require.cache[rutaLinea];
  require.cache[rutaSupabase] = { id: rutaSupabase, filename: rutaSupabase, loaded: true, exports: { from: () => q } };
  try {
    const linea = require(rutaLinea);
    await linea.historialDe("org-1", { lid: "84134751940861@lid" });
  } finally {
    delete require.cache[rutaLinea];
    if (previoSupabase) require.cache[rutaSupabase] = previoSupabase;
    else delete require.cache[rutaSupabase];
  }
  assert.match(columnas, /\bsenal_id\b/);
});
