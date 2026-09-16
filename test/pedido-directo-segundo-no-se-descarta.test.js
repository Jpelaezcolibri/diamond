// Dos pedidos del mismo colega, seguidos: el segundo no se puede perder.
//
// EL CASO (auditoria 2026-09-15). El anti-rafaga de avisarDemandaColegaInmediata
// existe por una razon real: Adriana recibio dos avisos del mismo colega con 32
// segundos de diferencia. Pero estaba implementado como un DESCARTE — el
// segundo aviso se tiraba y nadie se enteraba nunca — y Sofi ya le habia dicho
// al colega que lo iban a contactar.
//
// Lo que se fija: el segundo pedido NO sale en el momento (el anti-rafaga
// sigue valiendo) pero queda PENDIENTE, y la bandeja de salida lo levanta
// despues. El primero, que si salio, queda marcado y no vuelve a salir.

// RADAR_REVISOR_PHONE se lee al cargar el modulo: hay que ponerla antes.
process.env.RADAR_REVISOR_PHONE = "573011880668";

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const memory = require("../src/data/memory");
const tools = require("../src/agent/tools");
const { executeTool } = tools;
const advisors = require("../src/data/advisors");
const properties = require("../src/data/properties");
const allyProperties = require("../src/data/ally-properties");
const groupSignals = require("../src/data/group-signals");
const whatsappGroups = require("../src/data/whatsapp-groups");
const mensajeAsesor = require("../src/lib/mensaje-asesor");

const ORG = { id: "org-1", name: "Diamond" };
const DAIANA = { id: "adv-daiana", name: "Daiana Zea", phone: "573011880668" };
const DESDE = "2026-09-01T00:00:00.000Z";

const ctxColega = (mensaje) => ({
  org: ORG,
  lead: { id: "lead-jefferson", phone: "573024320431", nombre: "Jefferson" },
  colega: { lid: "222222222222222", telefono: "573024320431", nombre: "Jefferson" },
  lastUserMessage: mensaje,
});

let envios;
beforeEach(() => {
  envios = [];
  tools._resetAvisosDemandaColega();
  memory.groupSignals.length = 0;
  memory.whatsappGroups.length = 0;
});

function mocks(t) {
  t.mock.method(advisors, "findByPhone", async () => DAIANA);
  t.mock.method(properties, "search", async () => []);
  t.mock.method(allyProperties, "search", async () => []);
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async (org, telefono, texto) => {
    envios.push({ telefono, texto });
    return { ok: true };
  });
}

// El aviso sale sin await (no bloquea la respuesta al colega): hay que dejar
// que la microtarea corra antes de mirar el resultado.
const dejarCorrerElAviso = () => new Promise((r) => setImmediate(r));

async function pedir(mensaje, zona) {
  await executeTool("registrar_demanda_colega", { contacto_nombre: "Jefferson", zona, tipo: "apartamento" }, ctxColega(mensaje));
  await dejarCorrerElAviso();
}

async function pendientes() {
  const ids = await whatsappGroups.idsPedidoDirecto(ORG.id);
  return groupSignals.pedidosDirectosSinAvisar(ORG.id, { groupIds: ids, desdeIso: DESDE });
}

test("el pedido de un colega va a su propio grupo, no al de reenvios de un asesor", async (t) => {
  mocks(t);
  await pedir("Busco apto en Laureles para mi cliente", "Laureles");

  const ids = await whatsappGroups.idsPedidoDirecto(ORG.id);
  assert.strictEqual(ids.length, 1, "tiene que existir el grupo virtual de pedidos directos");
  assert.strictEqual(memory.groupSignals.length, 1);
  assert.strictEqual(memory.groupSignals[0].group_id, ids[0]);
});

test("el primer pedido sale en el momento y queda marcado como avisado", async (t) => {
  mocks(t);
  await pedir("Busco apto en Laureles para mi cliente", "Laureles");

  assert.strictEqual(envios.length, 1, "el primero sale ya");
  assert.strictEqual(envios[0].telefono, DAIANA.phone);
  assert.deepStrictEqual(await pendientes(), [], "si ya salio, no puede quedar pendiente");
});

test("el segundo pedido dentro de la ventana no sale ya, pero QUEDA PENDIENTE", async (t) => {
  mocks(t);
  await pedir("Busco apto en Laureles para mi cliente", "Laureles");
  await pedir("Y tambien busco casa en Envigado hasta 800 millones", "Envigado");

  // El anti-rafaga sigue valiendo: a Daiana no le entran dos mensajes seguidos.
  assert.strictEqual(envios.length, 1, "el anti-rafaga sigue frenando el segundo envio");

  // Pero el pedido no se tiro: la bandeja lo va a levantar.
  const quedan = await pendientes();
  assert.strictEqual(quedan.length, 1, "el segundo pedido tiene que quedar pendiente, no descartado");
  assert.match(quedan[0].texto_original, /casa en Envigado/);
});
