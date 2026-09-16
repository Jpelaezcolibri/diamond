// La bandeja de salida tiene que levantar el pedido directo que quedo
// pendiente. Si no, el arreglo del anti-rafaga es peor que el bug: la señal
// queda "pendiente" para siempre, nadie la manda, y no falla nada.
//
// Es la trampa que la spec (§6.3) dejo anotada: aprobadasSinAvisar exige
// revalidacion y un pedido directo no la tiene, asi que la bandeja no lo veia.
process.env.RADAR_REVISOR_PHONE = "573011880668";

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const memory = require("../src/data/memory");
const avisosSalida = require("../src/scheduler/avisos-salida");
const advisors = require("../src/data/advisors");
const groupSignals = require("../src/data/group-signals");
const whatsappGroups = require("../src/data/whatsapp-groups");
const mandatosData = require("../src/data/mandatos");
const entregaAsesor = require("../src/lib/entrega-asesor");
const ritmo = require("../src/lib/ritmo-avisos");

const ORG = { id: "org-1", name: "Diamond" };
const DAIANA = { id: "adv-daiana", name: "Daiana Zea", phone: "573011880668" };

let entregados;
beforeEach(() => {
  entregados = [];
  ritmo._reset();
  memory.groupSignals.length = 0;
  memory.whatsappGroups.length = 0;
});

function mocks(t) {
  t.mock.method(advisors, "findAsesorPrincipalRadar", async () => DAIANA);
  t.mock.method(groupSignals, "aprobadasSinAvisar", async () => []);
  t.mock.method(mandatosData, "pendientes", async () => []);
  t.mock.method(entregaAsesor, "entregarConRespaldo", async (org, asesor, texto) => {
    entregados.push({ asesor: asesor.name, texto });
    return { ok: true, advisor: DAIANA, wamid: "wamid-1", suplente: false };
  });
}

// Un pedido directo creado hace rato: pasada la gracia, dentro de la vigencia.
async function pedidoDirectoPendiente(texto = "Busco casa en Envigado hasta 800 millones") {
  const grupo = await whatsappGroups.asegurarGrupoVirtual(ORG.id, {
    prefijo: whatsappGroups.PREFIJO_PEDIDO_DIRECTO,
    nombre: whatsappGroups.NOMBRE_PEDIDO_DIRECTO,
  });
  const { signal } = await groupSignals.create(ORG.id, {
    group_id: grupo.id,
    wa_message_id: `directo-${memory.groupSignals.length}`,
    autor_nombre: "Jefferson",
    autor_telefono: "573024320431",
    clase: "demanda",
    origen: "reenvio",
    tipo: "casa",
    zona: "Envigado",
    texto_original: texto,
  });
  // Mas viejo que GRACIA_MIN para que la bandeja lo tome en esta pasada.
  signal.created_at = new Date(Date.now() - (avisosSalida.GRACIA_MIN + 5) * 60 * 1000).toISOString();
  return signal;
}

test("un pedido directo pendiente sale por la bandeja y nombra al colega", async (t) => {
  mocks(t);
  await pedidoDirectoPendiente();

  const r = await avisosSalida.procesarOrg(ORG, Date.now());

  assert.ok(r && r.ok, "la bandeja tiene que entregar algo");
  assert.strictEqual(entregados.length, 1);
  assert.match(entregados[0].texto, /Jefferson/);
  assert.match(entregados[0].texto, /Envigado/);
});

test("una vez entregado queda marcado y no vuelve a salir en la pasada siguiente", async (t) => {
  mocks(t);
  await pedidoDirectoPendiente();

  await avisosSalida.procesarOrg(ORG, Date.now());
  ritmo._reset(); // la segunda pasada no se frena por ritmo, se frena por la marca

  const segunda = await avisosSalida.procesarOrg(ORG, Date.now());
  assert.strictEqual(segunda, null, "ya se aviso: no hay nada pendiente");
  assert.strictEqual(entregados.length, 1, "no se puede avisar el mismo pedido dos veces");
});

test("sin nada pendiente la bandeja no manda nada", async (t) => {
  mocks(t);
  const r = await avisosSalida.procesarOrg(ORG, Date.now());
  assert.strictEqual(r, null);
  assert.strictEqual(entregados.length, 0);
});
