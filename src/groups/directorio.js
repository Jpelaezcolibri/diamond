// A quien podemos escribirle: el mapeo entre el LID con el que WhatsApp
// presenta a un colega en un grupo y su telefono real.
//
// POR QUE EXISTE. WhatsApp oculta el numero de los participantes de un grupo y
// manda un LID. Lo que el radar venia guardando en group_signals.autor_telefono
// son LIDs (14-17 digitos), no telefonos (12 en Colombia).
//
// DE DONDE SALE EL NUMERO (medido en produccion el 2026-08-22, 12 grupos):
//   · Lids API de WAHA (/lids/{lid}): resolvio 0 de 45 y /lids/count no
//     responde. Inservible en esta version, queda como segundo intento por si
//     una version futura la arregla.
//   · Lista de participantes: trae `pn` para ~80% de la gente y resuelve 30 de
//     45 colegas reales (67%).
//
// El 33% que no resuelve NO es un error: es el caso normal, y lo atiende una
// persona (ver el spec, §4.4).
//
// COSTO. Refrescar un grupo son cientos de participantes por HTTP — el mas
// grande tiene 878. Por eso: indice en memoria, respaldo en la base para
// sobrevivir un reinicio, y como maximo UN refresco por grupo cada
// MS_ENTRE_REFRESCOS. Un lid sin `pn` ahora tampoco lo va a tener en cinco
// minutos.

const colegas = require("../data/colegas");
const waha = require("../lib/waha");

// Un grupo no se refresca mas de una vez cada 10 minutos. El padron de un grupo
// gremial cambia de a poco; lo que cambia seguido es quien publica.
const MS_ENTRE_REFRESCOS = Number(process.env.RADAR_DIRECTORIO_REFRESCO_MIN || 10) * 60 * 1000;

const soloDigitos = (t) => String(t || "").replace(/\D/g, "") || null;

// lid (digitos) -> telefono. Se siembra de la base al primer uso por org.
const indice = new Map();
const sembrado = new Set(); // orgIds ya sembrados
const ultimoRefresco = new Map(); // orgId:jid -> ms

async function sembrar(orgId) {
  if (sembrado.has(orgId)) return;
  sembrado.add(orgId);
  for (const c of await colegas.listarConTelefono(orgId)) {
    const lid = soloDigitos(c.lid);
    if (lid && c.telefono) indice.set(`${orgId}:${lid}`, soloDigitos(c.telefono));
  }
}

// Trae los participantes de un grupo y mete en el indice todos los que traigan
// telefono. Se aprovecha la pasada completa: si ya se pago la llamada, se
// guarda todo lo que vino, no solo el lid que se estaba buscando.
async function refrescarGrupo(orgId, sesion, jid) {
  const ahora = Date.now();
  const cacheKey = `${orgId}:${jid}`;
  const previo = ultimoRefresco.get(cacheKey) || 0;
  if (ahora - previo < MS_ENTRE_REFRESCOS) return;
  ultimoRefresco.set(cacheKey, ahora);

  let participantes = [];
  try {
    participantes = await waha.participantesDeGrupo(sesion, jid);
  } catch (e) {
    // WAHA caido no puede tumbar el pipeline del radar: sin telefono el pedido
    // sale por el camino manual, que es una degradacion prevista.
    console.warn(`[directorio] No se pudieron traer los participantes de ${jid}: ${e.message}`);
    return;
  }

  for (const p of participantes) {
    const lid = soloDigitos(p.id);
    const tel = soloDigitos(p.telefono);
    if (lid && tel) indice.set(`${orgId}:${lid}`, tel);
  }
}

/**
 * El telefono de ese lid, o null.
 *
 * Con `jid` intenta refrescar ese grupo si no lo tiene (resolucion perezosa);
 * sin `jid` solo consulta lo que ya sabe.
 */
async function telefonoDe(orgId, lid, { sesion = null, jid = null } = {}) {
  const clave = soloDigitos(lid);
  if (!orgId || !clave) return null;

  await sembrar(orgId);
  const enIndice = indice.get(`${orgId}:${clave}`);
  if (enIndice) return enIndice;

  if (sesion && jid) {
    await refrescarGrupo(orgId, sesion, jid);
    const despues = indice.get(`${orgId}:${clave}`);
    if (despues) return despues;

    // Ultimo intento por la Lids API: hoy no resuelve nada (0 de 45 el
    // 2026-08-22) pero es barato y una version futura de WAHA podria arreglarla.
    const porApi = await waha.telefonoDeLid(sesion, clave).catch(() => null);
    if (porApi) {
      indice.set(`${orgId}:${clave}`, porApi);
      return porApi;
    }
  }

  return null;
}

/**
 * Deja constancia del colega y devuelve su telefono si se pudo resolver.
 *
 * Se guarda SIEMPRE, con telefono o sin el: el 33% sin numero es justamente la
 * lista de a quienes hay que responderle a mano.
 *
 * Si el guardado en si mismo falla (colegas.upsert devuelve false), esto
 * devuelve null en vez del telefono resuelto — Juan, revision 2026-08-24: antes
 * se devolvia el telefono igual, como si "registrar" hubiera funcionado aunque
 * la fila nunca se hubiera escrito. No prometas una constancia que no quedo.
 */
async function registrar(orgId, { lid, nombre = null, grupo = null, sesion = null, jid = null } = {}) {
  const clave = soloDigitos(lid);
  if (!orgId || !clave) return null;

  const telefono = await telefonoDe(orgId, clave, { sesion, jid });
  const guardado = await colegas.upsert(orgId, { lid: clave, telefono, nombre, grupo });
  return guardado ? telefono : null;
}

/**
 * ¿Ese telefono es de un colega de los grupos? Devuelve la fila o null.
 *
 * Es lo que permite que Sofi lo atienda como par y no como cliente
 * (src/agent/prompts.js#promptColega). Va contra la base y no contra el indice:
 * el indice esta ordenado por lid, y aca se pregunta al reves.
 */
async function esColega(orgId, telefono) {
  return colegas.porTelefono(orgId, telefono);
}

function _resetCache() {
  indice.clear();
  sembrado.clear();
  ultimoRefresco.clear();
}

module.exports = { telefonoDe, registrar, esColega, MS_ENTRE_REFRESCOS, _resetCache };
