// Sofi en la linea del radar tiene que correr DE VERDAD cuando entra el
// mensaje del colega (dm.procesarMensaje), y caer al puente de siempre si
// esta apagada o falta la columna autor. Leccion de linea-dm-puerta-lid-cerrada:
// la suite quedo verde 18 dias con el cableado roto.

const { test } = require("node:test");
const assert = require("node:assert");

delete process.env.RADAR_DM_CLASIFICAR; // fase 1: solo guardar

const dm = require("../src/groups/dm");
const groupSignals = require("../src/data/group-signals");
const lineaDm = require("../src/data/linea-dm");
const sofiLinea = require("../src/groups/sofi-linea");
const puente = require("../src/groups/puente-sofi");

const ORG = { id: "org-1", contact_whatsapp_number: "573009998877" };
const mensaje = {
  waMessageId: "wamid-9", sesion: "DaianaDiamond", remitenteId: "84134751940861@lid",
  remitenteTelefono: null, remitenteLid: "84134751940861@lid", remitenteNombre: "Projency Inmobiliaria",
  texto: "Cuál es tu nombre", fechaMensaje: "2026-10-21T21:57:00Z",
};

function preparar(t, resultadoSofi) {
  const llamadas = { sofi: 0, puente: 0 };
  t.mock.method(groupSignals, "buscarPorLid", async () => ({ id: "sig-1", codigo_colega: "7S63" }));
  t.mock.method(groupSignals, "buscarPorTelefono", async () => null);
  t.mock.method(lineaDm, "create", async () => ({ mensaje: { id: "dm-9" }, duplicado: false }));
  t.mock.method(sofiLinea, "responder", async () => { llamadas.sofi += 1; return { resultado: resultadoSofi }; });
  t.mock.method(puente, "tenderPuente", async () => { llamadas.puente += 1; return { resultado: "tendido" }; });
  return llamadas;
}

test("encendida: contesta Sofi y no sale el puente", async (t) => {
  process.env.RADAR_SOFI_LINEA = "true";
  const ll = preparar(t, "respondido");
  const r = await dm.procesarMensaje(ORG, mensaje);
  assert.strictEqual(r.resultado, "guardado");
  assert.strictEqual(ll.sofi, 1);
  assert.strictEqual(ll.puente, 0);
});

test("encendida pero sin la columna autor: sale el puente de siempre", async (t) => {
  process.env.RADAR_SOFI_LINEA = "true";
  const ll = preparar(t, "falta_autor");
  await dm.procesarMensaje(ORG, mensaje);
  assert.strictEqual(ll.sofi, 1);
  assert.strictEqual(ll.puente, 1);
});

test("apagada: ni se consulta a Sofi, sale el puente", async (t) => {
  delete process.env.RADAR_SOFI_LINEA;
  const ll = preparar(t, "respondido");
  await dm.procesarMensaje(ORG, mensaje);
  assert.strictEqual(ll.sofi, 0);
  assert.strictEqual(ll.puente, 1);
});

test("si Sofi revienta, el mensaje igual queda guardado", async (t) => {
  process.env.RADAR_SOFI_LINEA = "true";
  preparar(t, "respondido");
  t.mock.method(sofiLinea, "responder", async () => { throw new Error("boom"); });
  const r = await dm.procesarMensaje(ORG, mensaje);
  assert.strictEqual(r.resultado, "guardado");
});
