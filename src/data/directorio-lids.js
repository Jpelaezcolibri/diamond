// La cache de ruteo lid -> telefono, persistida.
//
// Ver db/migrations/2026-09-02_directorio_lids.sql para el porque y, sobre
// todo, para el alcance: esto NO es una lista de contactos. A quien se le
// escribe lo sigue decidiendo src/groups/politica.js#decidirDm, que solo
// habilita el DM al colega que acaba de publicar un pedido que cruzamos.
//
// Sin la migracion corrida, todo degrada solo: guardar no hace nada y cargar
// devuelve vacio, con un aviso una sola vez. El radar sigue funcionando como
// antes, preguntandole a WAHA en el momento.

const supabase = require("./supabase");
const memory = require("./memory");

const LOTE = 500;
let faltaTabla = false;

function esTablaFaltante(error) {
  const c = String(error?.code || "");
  const m = String(error?.message || "");
  return c === "42P01" || /does not exist|no existe/i.test(m);
}

function avisarFaltaTabla() {
  if (faltaTabla) return;
  faltaTabla = true;
  console.warn(
    "[directorio] Falta correr db/migrations/2026-09-02_directorio_lids.sql — " +
      "el mapa lid→telefono no se esta guardando, asi que cada reinicio lo pierde " +
      "y hay que volver a preguntarle a WAHA."
  );
}

/**
 * Guarda (o refresca) los pares vistos en una pasada. Idempotente.
 * @param pares [{ lid, telefono }] — ya validados por quien llama
 * @returns cuantos se escribieron
 */
async function guardar(orgId, pares) {
  const filas = (pares || []).filter((p) => p && p.lid && p.telefono);
  if (!orgId || filas.length === 0) return 0;

  if (!supabase) {
    memory.directorioLids = memory.directorioLids || [];
    for (const p of filas) {
      const ya = memory.directorioLids.find((x) => x.org_id === orgId && x.lid === p.lid);
      if (ya) ya.telefono = p.telefono;
      else memory.directorioLids.push({ org_id: orgId, lid: p.lid, telefono: p.telefono });
    }
    return filas.length;
  }
  if (faltaTabla) return 0;

  const ahora = new Date().toISOString();
  let escritos = 0;
  // En lotes: una sola sentencia con 10.000 filas es un timeout esperando
  // pasar, y ademas un fallo parcial ahi perderia toda la pasada.
  for (let i = 0; i < filas.length; i += LOTE) {
    const lote = filas.slice(i, i + LOTE).map((p) => ({
      org_id: orgId,
      lid: p.lid,
      telefono: p.telefono,
      actualizado_at: ahora,
    }));
    const { error } = await supabase.from("directorio_lids").upsert(lote, { onConflict: "org_id,lid" });
    if (error) {
      if (esTablaFaltante(error)) {
        avisarFaltaTabla();
        return escritos;
      }
      console.warn("[directorio] no se pudo guardar un lote del mapa lid→telefono:", error.message);
      continue;
    }
    escritos += lote.length;
  }
  return escritos;
}

/**
 * Todo el mapa de una org, para sembrar el indice en memoria al arrancar.
 * @returns [{ lid, telefono }]
 */
async function listar(orgId) {
  if (!orgId) return [];
  if (!supabase) {
    return (memory.directorioLids || []).filter((x) => x.org_id === orgId);
  }
  if (faltaTabla) return [];

  const filas = [];
  let desde = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("directorio_lids")
      .select("lid, telefono")
      .eq("org_id", orgId)
      .order("lid", { ascending: true })
      .range(desde, desde + 999);
    if (error) {
      if (esTablaFaltante(error)) {
        avisarFaltaTabla();
        return [];
      }
      console.warn("[directorio] no se pudo leer el mapa lid→telefono:", error.message);
      return filas;
    }
    filas.push(...(data || []));
    if (!data || data.length < 1000) break;
    desde += 1000;
  }
  return filas;
}

function _reset() {
  faltaTabla = false;
  if (memory.directorioLids) memory.directorioLids.length = 0;
}

module.exports = { guardar, listar, _reset };
