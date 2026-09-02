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
const lidsGuardados = require("../data/directorio-lids");
const waha = require("../lib/waha");
const { esCelularColombiano } = require("../lib/contacto");

// Un grupo no se refresca mas de una vez cada 10 minutos. El padron de un grupo
// gremial cambia de a poco; lo que cambia seguido es quien publica.
const MS_ENTRE_REFRESCOS = Number(process.env.RADAR_DIRECTORIO_REFRESCO_MIN || 10) * 60 * 1000;

// Si el refresco FALLA (WAHA caido, timeout de 20 s en un grupo de 900 en
// hora pico), el grupo vuelve a ser consultable a los 30 s, no a los 10 min.
// Medido el 2026-09-02: el directorio en vivo llevaba 0 telefonos guardados
// en una semana mientras la misma lista resolvia el 80% en frio -- un fallo
// convertia el throttle en 10 minutos de ceguera para todo el grupo.
const MS_REINTENTO_TRAS_FALLO = 30 * 1000;

const soloDigitos = (t) => String(t || "").replace(/\D/g, "") || null;

// lid (digitos) -> telefono. Se siembra de la base al primer uso por org.
const indice = new Map();
const sembrado = new Set(); // orgIds ya sembrados
const ultimoRefresco = new Map(); // orgId:jid -> ms
// Refrescos EN VUELO por grupo. vivo.js dispara directorio.registrar sin
// await y, segundos despues, asistir() vuelve a preguntar por el mismo lid:
// antes la segunda pregunta veia el throttle recien puesto por la primera y
// devolvia null aunque la lista ya estuviera llegando. Ahora espera la misma
// promesa en vez de saltarsela.
const enVuelo = new Map(); // orgId:jid -> Promise

// Siembra el indice desde la base. Dos fuentes, en este orden:
//
//   1. directorio_lids — el mapa COMPLETO de participantes visibles que se fue
//      juntando en los calentamientos (Juan, 2026-09-02: "los numeros que ya
//      se pueden ver en todos los grupos como base de datos para que no tenga
//      que ir a waha a revisar en cada respuesta"). Miles de pares.
//   2. colegas_grupos — los colegas con los que ya hubo interaccion real. Va
//      DESPUES para que pise a la cache si difieren: ese telefono se confirmo
//      en una conversacion, el de la cache solo se vio en una lista.
//
// Antes solo existia la segunda, con 66 filas, asi que cada reinicio del bot
// dejaba al radar dependiendo de que WAHA respondiera en ese instante.
async function sembrar(orgId) {
  if (sembrado.has(orgId)) return;
  sembrado.add(orgId);

  let deCache = 0;
  for (const par of await lidsGuardados.listar(orgId).catch(() => [])) {
    const lid = soloDigitos(par.lid);
    if (lid && par.telefono) {
      indice.set(`${orgId}:${lid}`, soloDigitos(par.telefono));
      deCache++;
    }
  }
  for (const c of await colegas.listarConTelefono(orgId)) {
    const lid = soloDigitos(c.lid);
    if (lid && c.telefono) indice.set(`${orgId}:${lid}`, soloDigitos(c.telefono));
  }
  if (deCache > 0) {
    console.log(`[directorio] sembrado con ${deCache} pares guardados — sin preguntarle nada a WAHA.`);
  }
}

// Trae los participantes de un grupo y mete en el indice todos los que traigan
// telefono. Se aprovecha la pasada completa: si ya se pago la llamada, se
// guarda todo lo que vino, no solo el lid que se estaba buscando.
// Devuelve cuantos pares lid->telefono dejo en el indice, o null si no
// refresco (throttle) o fallo.
async function refrescarGrupo(orgId, sesion, jid, { forzar = false } = {}) {
  const cacheKey = `${orgId}:${jid}`;
  if (enVuelo.has(cacheKey)) return enVuelo.get(cacheKey);

  const ahora = Date.now();
  const previo = ultimoRefresco.get(cacheKey) || 0;
  if (!forzar && ahora - previo < MS_ENTRE_REFRESCOS) return null;
  ultimoRefresco.set(cacheKey, ahora);

  const tarea = (async () => {
    let participantes = [];
    const t0 = Date.now();
    try {
      participantes = await waha.participantesDeGrupo(sesion, jid);
    } catch (e) {
      // WAHA caido no puede tumbar el pipeline del radar: sin telefono el pedido
      // sale por el camino manual, que es una degradacion prevista. Pero el
      // fallo no compra 10 minutos de silencio: se vuelve a poder preguntar a
      // los 30 s.
      console.warn(`[directorio] No se pudieron traer los participantes de ${jid}: ${e.message}`);
      ultimoRefresco.set(cacheKey, ahora - MS_ENTRE_REFRESCOS + MS_REINTENTO_TRAS_FALLO);
      return null;
    }

    let conTelefono = 0;
    const nuevos = [];
    for (const p of participantes) {
      const lid = soloDigitos(p.id);
      const tel = soloDigitos(p.telefono);
      // esCelularColombiano y no un truthy check: `pn` puede venir con basura,
      // y esta cache es la que despues decide a que numero sale un mensaje.
      if (lid && tel && esCelularColombiano(tel)) {
        indice.set(`${orgId}:${lid}`, tel);
        nuevos.push({ lid, telefono: tel });
        conTelefono++;
      }
    }
    // Se persiste la pasada entera (Juan, 2026-09-02). Es lo que convierte la
    // resolucion en una consulta local: WAHA pasa a servir solo para DESCUBRIR
    // pares nuevos, nunca para responder un pedido. Best-effort: si falla, el
    // indice en memoria igual quedo cargado para este proceso.
    if (nuevos.length) {
      await lidsGuardados
        .guardar(orgId, nuevos)
        .catch((e) => console.warn("[directorio] no se pudo guardar el mapa lid->telefono:", e.message));
    }
    // Una lista vacia tampoco se cree por 10 min: un grupo gremial nunca esta
    // vacio, asi que es un fallo silencioso de WAHA (ver participantesDeGrupo).
    if (participantes.length === 0) {
      ultimoRefresco.set(cacheKey, ahora - MS_ENTRE_REFRESCOS + MS_REINTENTO_TRAS_FALLO);
    }
    // Una linea por refresco (como maximo una cada MS_ENTRE_REFRESCOS por
    // grupo): es lo que faltaba para saber, desde los logs, si la lista llega
    // vacia, llega sin `pn`, o tarda mas que el timeout de waha.js.
    console.log(
      `[directorio] refresco ${jid}: ${participantes.length} participantes, ${conTelefono} con telefono, ${Date.now() - t0} ms`
    );
    return conTelefono;
  })();

  enVuelo.set(cacheKey, tarea);
  try {
    return await tarea;
  } finally {
    enVuelo.delete(cacheKey);
  }
}

/**
 * Calienta el indice con TODOS los grupos escuchados, uno por uno, para que
 * la busqueda en vivo sea un acierto en memoria y nunca dependa de una
 * llamada a WAHA en el momento del pedido (src/scheduler/radar-directorio.js).
 * `forzar` salta el throttle: es el calentamiento programado, no un pedido.
 */
async function calentar(orgId, sesion, jids, { forzar = true } = {}) {
  let refrescados = 0;
  let pares = 0;
  for (const jid of jids || []) {
    const n = await refrescarGrupo(orgId, sesion, jid, { forzar });
    if (n !== null && n !== undefined) {
      refrescados++;
      pares += n;
    }
  }
  return { grupos: (jids || []).length, refrescados, pares, indice: tamanoIndice(orgId) };
}

/**
 * Rellena el telefono de los colegas ya registrados que no lo tienen, con lo
 * que el indice sepa ahora. Devuelve cuantos se completaron. Se guarda solo
 * quien YA publico un pedido: la lista completa de participantes sigue
 * viviendo solo en memoria (ver db/migrations/2026-08-22_colegas_grupos.sql).
 */
async function rellenarColegas(orgId) {
  await sembrar(orgId);
  let completados = 0;
  for (const c of await colegas.listarSinTelefono(orgId)) {
    const lid = soloDigitos(c.lid);
    const tel = lid ? indice.get(`${orgId}:${lid}`) : null;
    if (!tel) continue;
    const ok = await colegas.upsert(orgId, { lid, telefono: tel });
    if (ok) completados++;
  }
  return completados;
}

function tamanoIndice(orgId) {
  let n = 0;
  const prefijo = `${orgId}:`;
  for (const k of indice.keys()) if (k.startsWith(prefijo)) n++;
  return n;
}

/**
 * El telefono de ese lid, o null.
 *
 * Con `jid` intenta refrescar ese grupo si no lo tiene (resolucion perezosa);
 * sin `jid` solo consulta lo que ya sabe.
 */
async function telefonoDe(orgId, lid, { sesion = null, jid = null, pista = null } = {}) {
  const clave = soloDigitos(lid);
  if (!orgId || !clave) return null;

  // PISTA: el numero que a veces viaja en el propio mensaje del grupo
  // (whatsapp-group.js#telefonoVisible). Es la fuente mas barata que hay —
  // cero HTTP — y la unica que funciona para un colega que no aparece con
  // `pn` en la lista de participantes. Se exige la misma validacion estricta
  // que el resto: un lid disfrazado de numero nunca puede entrar aca.
  const sugerido = soloDigitos(pista);
  if (sugerido && esCelularColombiano(sugerido)) {
    indice.set(`${orgId}:${clave}`, sugerido);
    return sugerido;
  }

  // WhatsApp casi siempre entrega un LID oculto (14-17 digitos) para el
  // participante de un grupo, pero alguna vez entrega el numero visible
  // directo (@c.us) en su lugar — ver la nota de alerta-asesor.js, revision
  // 2026-08-24. Si lo que llego YA tiene forma de celular colombiano real
  // (esCelularColombiano: 3 + 9 digitos, con o sin el 57 de pais), no hay
  // nada que resolver: ir al indice o a WAHA solo demoraria un numero que ya
  // se tiene a mano.
  //
  // ESTRICTO Y NO esMarcable (code review post-merge, 2026-08-24): esta
  // funcion es justo el camino que ACEPTA un numero como bueno y lo deja
  // guardado como `telefono` del colega (ver registrar() mas abajo) para que
  // despues se le escriba directo — esMarcable solo exige <=13 digitos, asi
  // que un LID de 10-13 (nunca medido en produccion, pero tampoco imposible)
  // pasaria igual y quedaria guardado como si fuera un celular real.
  if (esCelularColombiano(clave)) return clave;

  await sembrar(orgId);
  const enIndice = indice.get(`${orgId}:${clave}`);
  if (enIndice) return enIndice;

  // Con el indice sembrado desde la base, llegar hasta WAHA es ahora la
  // excepcion —un lid que nunca se vio en ninguna pasada— y no el camino
  // normal de cada pedido.
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
async function registrar(orgId, { lid, nombre = null, grupo = null, sesion = null, jid = null, pista = null } = {}) {
  const clave = soloDigitos(lid);
  if (!orgId || !clave) return null;

  const telefono = await telefonoDe(orgId, clave, { sesion, jid, pista });
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
  enVuelo.clear();
}

module.exports = {
  telefonoDe, registrar, esColega, calentar, rellenarColegas, tamanoIndice,
  MS_ENTRE_REFRESCOS, MS_REINTENTO_TRAS_FALLO, _resetCache,
};
