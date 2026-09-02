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

// select-then-insert contra un unique(org_id, lid), un solo reintento
// (Juan, revision 2026-08-24). La carrera es real, no teorica: un colega
// difunde el mismo pedido a varios grupos y la cola del radar es POR GRUPO
// (src/groups/vivo.js), asi que dos mensajes del mismo colega se procesan en
// paralelo. Los dos hacen el SELECT antes de que cualquiera termine el
// INSERT, los dos ven "no existe" y los dos intentan crear la fila: el
// segundo pisa el unique(org_id, lid) con 23505 (unique_violation). Sin este
// reintento esa fila se perdia sin rastro en un catch generico — este
// proyecto ya perdio 16 dias de sync y 9 horas de radar por fallos silenciosos
// exactamente asi (ver migraciones-supabase-pendientes en la memoria del
// repo). Un reintento alcanza: para cuando este segundo intento vuelve a
// preguntar, la fila que gano la carrera ya existe, y esta pasada la
// encuentra y actualiza en vez de reinsertar.
async function guardarEnBase(orgId, clave, tel, nombre, grupo, ahora, yaReintento = false) {
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
    if (e2) {
      if (e2.code === "23505" && !yaReintento) {
        return guardarEnBase(orgId, clave, tel, nombre, grupo, ahora, true);
      }
      throw e2;
    }
    return;
  }

  const grupos = Array.isArray(data.grupos) ? data.grupos : [];
  const patch = { ultimo_visto: ahora };
  if (tel) patch.telefono = tel;
  if (nombre) patch.nombre = nombre;
  if (grupo && !grupos.includes(grupo)) patch.grupos = [...grupos, grupo];

  const { error: e3 } = await supabase.from("colegas_grupos").update(patch).eq("id", data.id);
  if (e3) throw e3;
}

/**
 * Alta o actualizacion de un colega, por `lid`. Devuelve true si de verdad
 * quedo guardado, false si no (Juan, revision 2026-08-24: el catch generico
 * devolvia undefined tanto en exito como en fallo — indistinguible — y
 * directorio.registrar devolvia el telefono como si se hubiera guardado
 * aunque el guardado hubiera fallado. Este proyecto ya perdio 16 dias de sync
 * y 9 horas de radar por fallos silenciosos exactamente asi).
 *
 * Un telefono ya conocido NUNCA se sobrescribe con null: si un refresco de
 * participantes viene sin `pn`, perder el numero que ya teniamos seria un
 * retroceso silencioso.
 */
async function upsert(orgId, { lid, telefono = null, nombre = null, grupo = null } = {}) {
  const clave = soloDigitos(lid);
  if (!orgId || !clave) return false;
  const tel = soloDigitos(telefono);
  const ahora = new Date().toISOString();

  if (!supabase) {
    const existente = memory.colegasGrupos.find((c) => c.org_id === orgId && c.lid === clave);
    if (existente) {
      if (tel) existente.telefono = tel;
      if (nombre) existente.nombre = nombre;
      if (grupo && !existente.grupos.includes(grupo)) existente.grupos.push(grupo);
      existente.ultimo_visto = ahora;
      return true;
    }
    memory.colegasGrupos.push({
      id: memory.uid(), org_id: orgId, lid: clave, telefono: tel, nombre,
      grupos: grupo ? [grupo] : [], primer_visto: ahora, ultimo_visto: ahora,
    });
    return true;
  }

  try {
    await guardarEnBase(orgId, clave, tel, nombre, grupo, ahora);
    return true;
  } catch (e) {
    if (esTablaFaltante(e)) {
      avisarFaltaTabla();
      return false;
    }
    // console.error (no warn): esto es un fallo real de escritura, no una
    // migracion pendiente. El warn de antes no lo miraba nadie.
    console.error(`[colegas] No se pudo guardar el colega ${clave} (org ${orgId}):`, e.message);
    return false;
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

// Los colegas registrados que todavia NO tienen telefono: es la lista que el
// calentamiento del directorio (src/scheduler/radar-directorio.js) intenta
// rellenar cada vez que refresca los grupos. Mismo paginado que
// listarConTelefono.
async function listarSinTelefono(orgId) {
  if (!orgId) return [];

  if (!supabase) {
    return memory.colegasGrupos
      .filter((c) => c.org_id === orgId && !c.telefono)
      .map((c) => ({ lid: c.lid, nombre: c.nombre }));
  }

  try {
    const filas = [];
    let desde = 0;
    for (;;) {
      const { data, error } = await supabase
        .from("colegas_grupos")
        .select("lid, nombre")
        .eq("org_id", orgId)
        .is("telefono", null)
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
    console.warn("[colegas] No se pudo listar los colegas sin telefono:", e.message);
    return [];
  }
}

module.exports = { upsert, porTelefono, listarConTelefono, listarSinTelefono };
