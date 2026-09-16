// El pedido de un colega que llega mientras el anterior todavia "calienta".
//
// EL HUECO (auditoria del 2026-09-15). avisarDemandaColegaInmediata guarda una
// marca en memoria y DESCARTA el aviso si ese colega ya genero uno en los
// ultimos 15 minutos. El motivo era bueno: Adriana recibio dos avisos del
// mismo colega con 32 segundos de diferencia porque el colega sumo detalle en
// un segundo mensaje.
//
// Pero cuando el colega manda un pedido DISTINTO dentro de esos 15 minutos, el
// aviso se descartaba igual — y Sofi ya le habia dicho que lo iban a
// contactar. Promesa sin respaldo.
//
// LA TRAMPA (spec §6.3). La bandeja de salida levanta lo pendiente con
// groupSignals.aprobadasSinAvisar, que exige `revalidacion is not null`. Un
// pedido directo NUNCA tiene revalidacion: no paso por el radar, lo escribio
// el colega en el chat. Asi que dejar la señal "pendiente" no alcanzaba — la
// bandeja no la iba a ver nunca, y el pedido se perdia igual, en silencio.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const memory = require("../src/data/memory");
const groupSignals = require("../src/data/group-signals");
const whatsappGroups = require("../src/data/whatsapp-groups");

const ORG = "org-1";
const DESDE = "2026-09-01T00:00:00.000Z";

beforeEach(() => {
  memory.groupSignals.length = 0;
  memory.whatsappGroups.length = 0;
});

async function crearPedidoDirecto(waId, { enviadoAt = null } = {}) {
  const grupo = await whatsappGroups.asegurarGrupoVirtual(ORG, {
    prefijo: whatsappGroups.PREFIJO_PEDIDO_DIRECTO,
    nombre: "Pedidos directos a Sofi",
  });
  const { signal } = await groupSignals.create(ORG, {
    group_id: grupo.id,
    wa_message_id: waId,
    autor_nombre: "Jefferson",
    autor_telefono: "573024320431",
    clase: "demanda",
    origen: "reenvio",
    texto_original: "Busco apto en Laureles para mi cliente",
  });
  if (enviadoAt) signal.enviado_at = enviadoAt;
  return { grupo, signal };
}

test("la bandeja de siempre NO ve un pedido directo: no tiene revalidacion", async () => {
  await crearPedidoDirecto("directo-1");
  const pendientes = await groupSignals.aprobadasSinAvisar(ORG, { desdeIso: DESDE });
  assert.strictEqual(
    pendientes.length,
    0,
    "aprobadasSinAvisar exige revalidacion — este es el motivo por el que hace falta una consulta aparte"
  );
});

test("la consulta nueva SI ve el pedido directo pendiente", async () => {
  const { grupo, signal } = await crearPedidoDirecto("directo-1");
  const pendientes = await groupSignals.pedidosDirectosSinAvisar(ORG, {
    groupIds: [grupo.id],
    desdeIso: DESDE,
  });
  assert.deepStrictEqual(
    pendientes.map((s) => s.id),
    [signal.id]
  );
});

test("un pedido directo ya avisado no vuelve a salir", async () => {
  const { grupo } = await crearPedidoDirecto("directo-1", { enviadoAt: "2026-09-15T12:00:00.000Z" });
  const pendientes = await groupSignals.pedidosDirectosSinAvisar(ORG, {
    groupIds: [grupo.id],
    desdeIso: DESDE,
  });
  assert.strictEqual(pendientes.length, 0);
});

test("sin grupos de pedido directo no devuelve nada, y no devuelve TODO por descuido", async () => {
  await crearPedidoDirecto("directo-1");
  const pendientes = await groupSignals.pedidosDirectosSinAvisar(ORG, { groupIds: [], desdeIso: DESDE });
  assert.strictEqual(
    pendientes.length,
    0,
    "una lista vacia de grupos significa 'ninguno', nunca 'todos'"
  );
});
