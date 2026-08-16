// Cuan viejo es el inventario que tenemos.
//
// DMAP sincroniza desde Wasi una vez al dia y deja una fila en `sync_runs`.
// Nadie lee esa tabla: el 2026-08-01 se descubrio que el publicador llevaba 16
// dias detenido y nadie se habia enterado, y la auditoria recomendo un
// "detector de silencio" que nunca se construyo.
//
// Para el radar en vivo eso deja de ser un problema de observabilidad y pasa a
// ser uno de reputacion: si el sync se detuvo el martes, el bot sigue ofreciendo
// en los grupos gremiales el inventario del martes —con las que ya se
// vendieron— con total seguridad y sin que nada falle.
//
// Por eso el radar consulta esto antes de publicar y, si el dato esta viejo, se
// calla. Es la misma regla que gobierna todo el modulo: ante la duda, no.

const supabase = require("./supabase");

// Cuantas horas puede tener el ultimo sync exitoso para seguir confiando en el
// inventario. El sync corre cada 24 h, asi que 30 da margen para una corrida
// que se atraso sin dar por bueno un silencio de dos dias.
const HORAS_FRESCO = Number(process.env.GRUPOS_SYNC_MAX_HORAS || 30);

// El webhook consulta esto por mensaje; un viaje a Supabase cada vez seria caro
// y la respuesta no cambia en segundos.
const CACHE_MS = 5 * 60 * 1000;
let cache = null; // { at, orgId, iso }

async function ultimoSyncExitoso(orgId) {
  if (cache && cache.orgId === orgId && Date.now() - cache.at < CACHE_MS) return cache.iso;

  if (!supabase) {
    // Sin base no hay inventario que sincronizar: es el modo de desarrollo con
    // datos en memoria, y ahi el dato siempre es "fresco".
    return new Date().toISOString();
  }

  try {
    const { data, error } = await supabase
      .from("sync_runs")
      .select("started_at")
      .eq("org_id", orgId)
      .eq("status", "success")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    const iso = data?.started_at || null;
    cache = { at: Date.now(), orgId, iso };
    return iso;
  } catch (e) {
    console.error("[radar] No se pudo leer el estado del sync:", e.message);
    // null = no se pudo verificar. Quien llama lo trata como "no fresco", que es
    // la direccion segura: sin poder probar que el inventario esta al dia, no se
    // publica. Y NO se cachea, para reintentar en el proximo mensaje.
    return null;
  }
}

// { fresco, iso, horas } — `horas` sirve para el aviso del watchdog y para
// explicar en el CRM por que el radar dejo de responder.
async function estadoDelInventario(orgId, { horasMax = HORAS_FRESCO, ahora = new Date() } = {}) {
  const iso = await ultimoSyncExitoso(orgId);
  if (!iso) return { fresco: false, iso: null, horas: null };
  const horas = (ahora.getTime() - new Date(iso).getTime()) / 3600000;
  return { fresco: horas <= horasMax, iso, horas: Math.round(horas * 10) / 10 };
}

function _resetCache() {
  cache = null;
}

module.exports = { ultimoSyncExitoso, estadoDelInventario, HORAS_FRESCO, _resetCache };
