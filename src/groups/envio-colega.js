// El envio del DM al colega, en un solo lugar para los tres caminos que le
// escriben: el automatico (vivo.js#asistir), aprobar desde Sofi
// (vivo.js#aprobarManual) y el DM manual del CRM (vivo.js#responderPorDmManual).
//
// POR QUE EXISTE (Juan, 2026-09-10, spec dm-separados §3.1; revision del
// camino de respuesta 2026-09-06, H2). Hasta hoy cada camino llamaba a
// waha.enviarDm a su manera y ya habian divergido: el automatico reintentaba
// y caia al telefono si el lid fallaba, los manuales no. Con el DM partido en
// varios mensajes (una propiedad por mensaje) esa divergencia se multiplica,
// asi que la secuencia vive aca y los tres la usan igual.
//
// Lo que hace, en orden:
//   1. El PRIMER mensaje decide si el DM existe. Si WAHA lo rechaza antes de
//      que salga (previoAlEnvio) se reintenta UNA vez; si iba por lid y hay
//      telefono verificado, se prueba por el telefono. Un timeout NO se
//      reintenta: el estado es desconocido y duplicarle un mensaje a un colega
//      es la conducta por la que a uno lo reportan.
//   2. Los demas salen por el mismo destino que funciono, con una pausa entre
//      uno y otro (4 s por defecto): una rafaga de mensajes seguidos a un
//      numero que no te tiene agendado es lo que mas se parece a spam.
//   3. Si uno del medio falla, se CORTA ahi — no se reintenta ni se salta al
//      siguiente — y se devuelve lo que salio y lo que falto. Quien llama
//      registra solo lo que salio y le avisa a la asesora lo que falto.
//
// El candado de "solo llamada" sigue siendo el de waha.enviarDm: cada
// mensaje pasa por el.

// Entre el texto de cada mensaje, en respuesta_texto: el CRM lo muestra con
// saltos de linea, y asi se ve donde termina uno y empieza el otro.
const SEPARADOR = "\n\n— — —\n\n";

const PAUSA_MS = Number(process.env.RADAR_DM_PAUSA_MS ?? 4000);
const REINTENTO_MS = 3000;

const dormirReal = (ms) => new Promise((r) => setTimeout(r, ms));
let dormir = dormirReal;

// Solo para tests: sin esto, cada test de un DM de tres propiedades espera 12 s.
function _setDormirParaTests(fn) {
  dormir = fn || dormirReal;
}

/**
 * @param sesion            nombre de la sesion de WAHA (la linea)
 * @param orgId             para el candado de solo llamada de waha.enviarDm
 * @param telefono          telefono verificado del colega, o null
 * @param lid               si viene, el DM sale a <lid>@lid (via principal)
 * @param respaldoTelefono  si el primer mensaje por lid no sale, se prueba aca
 * @param mensajes          [{ texto, ref }] (redactar.mensajesAlColega)
 * @returns {
 *   ok,            true si salio al menos el primer mensaje
 *   completo,      true si salieron todos
 *   enviados,      [{ texto, ref, wamid }] en orden
 *   refsEnviadas,  refs de las fichas que salieron
 *   faltantes,     refs de las fichas que no salieron
 *   texto,         los textos que salieron, unidos por SEPARADOR
 *   wamid,         el del primer mensaje
 *   via,           "lid" | "telefono"
 *   error, previoAlEnvio   del ultimo fallo, si hubo
 * }
 */
async function enviarAlColega({ sesion, orgId, telefono = null, lid = null, respaldoTelefono = null, mensajes = [] } = {}) {
  // Require tardio: los tests reemplazan lib/waha.js en require.cache antes
  // de cargar vivo.js, y este modulo puede haber quedado cacheado antes.
  const waha = require("../lib/waha");
  const refsDe = (lista) => lista.map((m) => m.ref).filter(Boolean);

  if (!mensajes.length) {
    return { ok: false, completo: false, enviados: [], refsEnviadas: [], faltantes: [], texto: "", wamid: null, via: null, error: "sin_mensajes" };
  }

  let destinoTelefono = telefono;
  let opciones = lid ? { lid, orgId } : { orgId };
  const mandar = (texto) =>
    waha.enviarDm(sesion, destinoTelefono, texto, opciones).catch((e) => ({ ok: false, error: e.message, previoAlEnvio: false }));

  // 1. El primero, con su reintento y su respaldo.
  let r = await mandar(mensajes[0].texto);
  if (r && !r.ok && r.previoAlEnvio) {
    console.warn(`[radar] El DM no llego a salir (${r.error}); un reintento en ${REINTENTO_MS / 1000} s.`);
    await dormir(REINTENTO_MS);
    r = await mandar(mensajes[0].texto);
  }
  if (r && !r.ok && r.previoAlEnvio && lid && respaldoTelefono) {
    console.warn(`[radar] El DM por lid no salio (${r.error}); se reintenta por el telefono resuelto.`);
    destinoTelefono = respaldoTelefono;
    opciones = { orgId };
    r = await mandar(mensajes[0].texto);
  }
  if (!r || !r.ok) {
    return {
      ok: false, completo: false, enviados: [], refsEnviadas: [], faltantes: refsDe(mensajes),
      texto: "", wamid: null, via: opciones.lid ? "lid" : "telefono",
      error: r && r.error, previoAlEnvio: Boolean(r && r.previoAlEnvio),
    };
  }

  const enviados = [{ ...mensajes[0], wamid: r.wamid || null }];
  let error = null;
  let previoAlEnvio = false;

  // 2 y 3. Los demas, por el mismo destino; al primer fallo se corta.
  for (const m of mensajes.slice(1)) {
    await dormir(PAUSA_MS);
    const s = await mandar(m.texto);
    if (!s || !s.ok) {
      error = (s && s.error) || "envio_fallido";
      previoAlEnvio = Boolean(s && s.previoAlEnvio);
      console.warn(`[radar] El DM se corto en la ref ${m.ref || "(sin ref)"}: ${error}. Salieron ${enviados.length} de ${mensajes.length} mensajes.`);
      break;
    }
    enviados.push({ ...m, wamid: s.wamid || null });
  }

  const refsEnviadas = refsDe(enviados);
  const faltantes = refsDe(mensajes).filter((ref) => !refsEnviadas.includes(ref));
  return {
    ok: true,
    completo: faltantes.length === 0 && enviados.length === mensajes.length,
    enviados,
    refsEnviadas,
    faltantes,
    texto: enviados.map((e) => e.texto).join(SEPARADOR),
    wamid: enviados[0].wamid,
    via: opciones.lid ? "lid" : "telefono",
    error,
    previoAlEnvio,
  };
}

module.exports = { enviarAlColega, SEPARADOR, PAUSA_MS, _setDormirParaTests };
