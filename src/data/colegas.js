// Respaldo de los colegas de los grupos gremiales: su LID y, cuando WhatsApp lo
// deja ver, su telefono real. Ver db/migrations/2026-08-22_colegas_grupos.sql
// para el por que y para el limite de alcance (se escribe sobre interaccion
// real, nunca barriendo la lista de participantes).
//
// Dos consumidores: src/groups/directorio.js (resolver a quien escribirle) y la
// deteccion de colega en src/agent/engine.js (atenderlo como par y no como
// cliente).

const supabase = require("./supabase");
const memory = require("./memory");
const { mismoTelefono } = require("./advisors");

const soloDigitos = (t) => String(t || "").replace(/\D/g, "") || null;

// Variantes EXACTAS con las que la columna `telefono` podria estar guardada
// para el mismo numero (Juan, revision 2026-08-24). La migracion dice que
// `telefono` siempre lleva indicativo, pero dos rutas distintas lo escriben
// (WAHA participantes / lo que llegue por Cloud API) y no siempre coincide en
// si el indicativo esta o no. En vez de traer TODA la tabla y comparar en
// memoria con mismoTelefono —lo que PostgREST corta en 1.000 filas por
// defecto y el directorio ya pasa de 1.000 colegas, ademas de leer la tabla
// entera en cada mensaje entrante— se arman las 2-3 variantes plausibles y se
// consulta por ellas, que es lo que de verdad usa el indice parcial
// idx_colegas_grupos_telefono. Asume indicativo de Colombia (57): es lo unico
// que este bot atiende.
function variantesTelefono(tel) {
  const variantes = new Set([tel]);
  const cola10 = tel.slice(-10);
  if (cola10.length === 10) {
    variantes.add(cola10);
    variantes.add(`57${cola10}`);
  }
  return [...variantes];
}

function esTablaFaltante(error) {
  // 42P01: la tabla no existe. PGRST205: PostgREST no la tiene en su cache.
  return error?.code === "42P01" || error?.code === "PGRST205";
}

let faltaTabla = false;
function avisarFaltaTabla() {
  if (faltaTabla) return;
  faltaTabla = true;
  console.warn(
    "[colegas] Falta correr db/migrations/2026-08-22_colegas_grupos.sql — " +
    "no se estan respaldando los telefonos de los colegas ni se los va a reconocer cuando escriban."
  );
}

/**
 * Alta o actualizacion de un colega, por `lid`.
 *
 * Un telefono ya conocido NUNCA se sobrescribe con null: si un refresco de
 * participantes viene sin `pn`, perder el numero que ya teniamos seria un
 * retroceso silencioso.
 */
async function upsert(orgId, { lid, telefono = null, nombre = null, grupo = null } = {}) {
  const clave = soloDigitos(lid);
  if (!orgId || !clave) return;
  const tel = soloDigitos(telefono);
  const ahora = new Date().toISOString();

  if (!supabase) {
    const existente = memory.colegasGrupos.find((c) => c.org_id === orgId && c.lid === clave);
    if (existente) {
      if (tel) existente.telefono = tel;
      if (nombre) existente.nombre = nombre;
      if (grupo && !existente.grupos.includes(grupo)) existente.grupos.push(grupo);
      existente.ultimo_visto = ahora;
      return;
    }
    memory.colegasGrupos.push({
      id: memory.uid(), org_id: orgId, lid: clave, telefono: tel, nombre,
      grupos: grupo ? [grupo] : [], primer_visto: ahora, ultimo_visto: ahora,
    });
    return;
  }

  try {
    const { data, error } = await supabase
      .from("colegas_grupos")
      .select("id, telefono, nombre, grupos")
      .eq("org_id", orgId)
      .eq("lid", clave)
      .maybeSingle();
    if (error) throw error;

    if (!data) {
      const { error: e2 } = await supabase.from("colegas_grupos").insert({
        org_id: orgId, lid: clave, telefono: tel, nombre,
        grupos: grupo ? [grupo] : [],
      });
      if (e2) throw e2;
      return;
    }

    const grupos = Array.isArray(data.grupos) ? data.grupos : [];
    const patch = { ultimo_visto: ahora };
    if (tel) patch.telefono = tel;
    if (nombre) patch.nombre = nombre;
    if (grupo && !grupos.includes(grupo)) patch.grupos = [...grupos, grupo];

    const { error: e3 } = await supabase.from("colegas_grupos").update(patch).eq("id", data.id);
    if (e3) throw e3;
  } catch (e) {
    if (esTablaFaltante(e)) return avisarFaltaTabla();
    console.warn("[colegas] No se pudo guardar el colega:", e.message);
  }
}

/** El colega que tiene ese telefono, o null. */
async function porTelefono(orgId, telefono) {
  const tel = soloDigitos(telefono);
  if (!orgId || !tel || tel.length < 10) return null;

  if (!supabase) {
    const colega = memory.colegasGrupos.find(
      (c) => c.org_id === orgId && c.telefono && mismoTelefono(c.telefono, tel)
    );
    return colega ? { lid: colega.lid, telefono: colega.telefono, nombre: colega.nombre } : null;
  }

  try {
    const { data, error } = await supabase
      .from("colegas_grupos")
      .select("lid, telefono, nombre")
      .eq("org_id", orgId)
      .in("telefono", variantesTelefono(tel))
      .limit(5);
    if (error) throw error;
    return (data || []).find((c) => mismoTelefono(c.telefono, tel)) || null;
  } catch (e) {
    if (esTablaFaltante(e)) {
      avisarFaltaTabla();
      return null;
    }
    console.warn("[colegas] No se pudo buscar el colega por telefono:", e.message);
    return null;
  }
}

// Tamano de pagina para listarConTelefono. PostgREST corta en 1.000 filas por
// defecto y el diseño apunta a ~1.012 colegas (Juan, revision 2026-08-24):
// sin paginar, el corte es silencioso y le pega directo a la cobertura que
// esta tabla existe para medir.
const PAGINA_LISTADO = 1000;

/** Los colegas con telefono resuelto — semilla del indice del directorio. */
async function listarConTelefono(orgId) {
  if (!orgId) return [];

  if (!supabase) {
    return memory.colegasGrupos
      .filter((c) => c.org_id === orgId && c.telefono)
      .map((c) => ({ lid: c.lid, telefono: c.telefono, nombre: c.nombre }));
  }

  try {
    const filas = [];
    let desde = 0;
    for (;;) {
      const { data, error } = await supabase
        .from("colegas_grupos")
        .select("lid, telefono, nombre")
        .eq("org_id", orgId)
        .not("telefono", "is", null)
        .order("id", { ascending: true })
        .range(desde, desde + PAGINA_LISTADO - 1);
      if (error) throw error;
      filas.push(...(data || []));
      if (!data || data.length < PAGINA_LISTADO) break;
      desde += PAGINA_LISTADO;
    }
    return filas;
  } catch (e) {
    if (esTablaFaltante(e)) {
      avisarFaltaTabla();
      return [];
    }
    console.warn("[colegas] No se pudo listar los colegas:", e.message);
    return [];
  }
}

module.exports = { upsert, porTelefono, listarConTelefono };
