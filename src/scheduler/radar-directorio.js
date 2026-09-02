// Calienta el directorio de colegas (lid -> telefono) en segundo plano.
//
// POR QUE EXISTE (Juan, 2026-09-02). El DM automatico al colega depende de
// resolver su telefono, y la unica fuente que funciona es la lista de
// participantes de cada grupo (80% de cobertura medida ese dia: 10.095 de
// 12.828 participantes, 74 de 93 colegas que publicaron). Pero el directorio
// la pedia SOLO cuando llegaba un pedido, con un throttle de 10 min por grupo
// y un indice que vivia en memoria: entre un timeout en hora pico, cinco
// despliegues en un dia que borraban el indice, y el throttle que convertia
// cada fallo en 10 min de ceguera, el resultado real fue 0 telefonos guardados
// en una semana y 25 de 26 pedidos aprobados reenviados a mano.
//
// Con esto, el indice se llena al arrancar (a los 20 s, para no competir con
// el boot) y se refresca cada hora. Son ~31 llamadas de ~3 s a WAHA por la
// red interna de Railway: sin costo de IA ni de Meta. Ademas rellena el
// telefono de los colegas ya registrados que no lo tenian.

const organizations = require("../data/organizations");
const whatsappGroups = require("../data/whatsapp-groups");
const directorio = require("../groups/directorio");
const waha = require("../lib/waha");

const INTERVALO_MIN = Number(process.env.RADAR_DIRECTORIO_CALENTAR_MIN || 60);
const ESPERA_INICIAL_MS = 20 * 1000;

let timer = null;
let inicial = null;
let corriendo = false;

async function calentarOrg(org) {
  const sesiones = await whatsappGroups.listSessions(org.id).catch(() => []);
  const activa = sesiones.find((s) => s.estado === "activa");
  if (!activa) return null;

  const grupos = (await whatsappGroups.listGroups(org.id).catch(() => []))
    .filter((g) => g.jid && g.jid.endsWith("@g.us") && g.modo && g.modo !== "ignorar");
  const jids = grupos.map((g) => g.jid);

  const t0 = Date.now();
  const r = await directorio.calentar(org.id, activa.nombre, jids);
  const completados = await directorio.rellenarColegas(org.id).catch((e) => {
    console.warn("[directorio] No se pudieron rellenar los telefonos de los colegas:", e.message);
    return 0;
  });
  console.log(
    `[directorio] calentamiento ${org.name || org.id}: ${r.refrescados}/${r.grupos} grupos, ` +
      `${r.pares} pares en esta pasada, ${r.indice} en el indice, ${completados} colegas completados, ` +
      `${Math.round((Date.now() - t0) / 1000)} s`
  );
  return { ...r, completados };
}

async function tick() {
  if (corriendo) return; // una pasada tarda ~90 s; nunca dos a la vez
  if (!waha.configurado()) return;
  corriendo = true;
  try {
    for (const org of await organizations.listActive()) {
      await calentarOrg(org).catch((e) => console.error(`[directorio] fallo el calentamiento de ${org.id}:`, e.message));
    }
  } catch (e) {
    console.error("[directorio] fallo el calentamiento:", e.message);
  } finally {
    corriendo = false;
  }
}

function start() {
  if (!waha.configurado()) {
    console.log("[directorio] sin WAHA configurado: no se calienta el directorio.");
    return null;
  }
  if (timer) return timer;
  inicial = setTimeout(tick, ESPERA_INICIAL_MS);
  timer = setInterval(tick, INTERVALO_MIN * 60 * 1000);
  console.log(`[directorio] calentamiento activo — a los 20 s y cada ${INTERVALO_MIN} min`);
  return timer;
}

function stop() {
  if (timer) clearInterval(timer);
  if (inicial) clearTimeout(inicial);
  timer = null;
  inicial = null;
}

module.exports = { start, stop, tick, calentarOrg, INTERVALO_MIN };
