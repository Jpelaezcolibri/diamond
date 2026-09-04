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
//
// ═══ APAGADO POR DEFECTO (Juan, 2026-09-04) ═══
//
// "quiero es que lo apaguemos, no quiero nada que genere riesgo, todo lo que
// se pueda resolver con el lids lo hacemos por ahi".
//
// Que paso ese dia:
//   · WhatsApp empezo a responder rate-overlimit (429) a la lista de
//     participantes. El calentamiento termino "31/31 grupos, 0 pares, 0
//     colegas completados": todo el trafico, cero resultado.
//   · Se midio que 9 de cada 10 colegas no exponen telefono, asi que ni
//     funcionando del todo resolvia a la mayoria.
//   · Se confirmo con una entrega REAL que un DM a `<lid>@lid` llega. El
//     telefono dejo de ser un requisito para responder
//     (src/groups/politica.js#decidirDm).
// La linea del radar ya fue baneada una vez (2026-07-30). Este es el unico
// trabajo del bot que genera trafico sostenido contra WhatsApp sin que nadie
// lo pida, y estaba generandolo justo contra el endpoint que lo esta
// rechazando.
//
// El modulo NO se borra: la decision se puede revertir con
// RADAR_DIRECTORIO_CALENTAR_ENABLED=true, sin tocar codigo, si algun dia
// WhatsApp afloja. El interruptor se lee en cada llamada (no al cargar el
// modulo) para que encenderlo no dependa del orden de los requires.

const organizations = require("../data/organizations");
const whatsappGroups = require("../data/whatsapp-groups");
const directorio = require("../groups/directorio");
const waha = require("../lib/waha");

const INTERVALO_MIN = Number(process.env.RADAR_DIRECTORIO_CALENTAR_MIN || 60);
const ESPERA_INICIAL_MS = 20 * 1000;

// Solo un SI explicito enciende: cualquier otra cosa (vacio, "0", "false", una
// variable mal escrita en Railway) deja el calentamiento apagado. Es la
// direccion segura del default — equivocarse hacia "apagado" no le cuesta
// nada a nadie, equivocarse hacia "encendido" le cuesta trafico a una linea
// que ya fue baneada.
function calentamientoHabilitado() {
  return /^(1|true|si|sí|yes|on)$/i.test(String(process.env.RADAR_DIRECTORIO_CALENTAR_ENABLED || "").trim());
}

let timer = null;
let inicial = null;
let corriendo = false;

async function calentarOrg(org) {
  const sesiones = await whatsappGroups.listSessions(org.id).catch(() => []);
  // Se prefiere la marcada activa, pero con UNA sola sesion vinculada se usa
  // esa igual (2026-09-02): la columna `estado` puede quedar desactualizada
  // —paso en produccion— y calentar el indice solo LEE listas de
  // participantes, no manda nada, asi que fallar cerrado aca no protege de
  // nada y deja el DM automatico sin telefonos. El envio si sigue exigiendo
  // sesion activa donde corresponde (vivo.js#aprobarManual).
  const activa = sesiones.find((s) => s.estado === "activa") || (sesiones.length === 1 ? sesiones[0] : null);
  if (!activa) {
    if (sesiones.length > 1) {
      console.warn(`[directorio] ${sesiones.length} sesiones y ninguna activa: no se calienta (seria adivinar por cual).`);
    }
    return null;
  }

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
  // Tambien aca, no solo en start(): tick() esta exportado y cualquiera puede
  // forzar una pasada. Con el calentamiento apagado no puede salir trafico
  // contra WhatsApp por ninguna de las dos puertas.
  if (!calentamientoHabilitado()) return;
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
  // Primero el interruptor, antes que cualquier otra guarda: si esta apagado,
  // la razon que se loguea tiene que ser la decision (Juan, 2026-09-04) y no
  // un efecto colateral de que falte WAHA. Un apagado silencioso es como se
  // pierde una funcion sin que nadie se entere (informe de arranque,
  // 2026-09-02, hallazgo #4).
  if (!calentamientoHabilitado()) {
    console.log(
      "[directorio] calentamiento APAGADO por decision (Juan, 2026-09-04): WhatsApp respondia rate-overlimit " +
        "y el DM ahora sale por <lid>@lid. Se resuelve solo con directorio_lids. " +
        "Para reactivarlo: RADAR_DIRECTORIO_CALENTAR_ENABLED=true"
    );
    return null;
  }
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
