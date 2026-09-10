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
const { telefonoEnTexto } = require("../lib/contacto");

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

// ── "Solo llamada" (Juan, 2026-09-10) ────────────────────────────────────
//
// El caso: Angela Moscoso le pidio a Sofi que la contacten SOLO por llamada.
// Sofi dijo "ya esta anotado" sin guardar nada, y dos horas despues el radar le
// mando un DM. Decision de Juan: permanente, ningun DM, cada pedido suyo va al
// aviso de la asesora para que la llame. Ver
// docs/superpowers/specs/2026-09-10-colega-solo-llamada-design.md.
//
// TRES LLAVES, NO UNA (Juan: "que no se nos filtren los mensajes porque queda
// marcado el colega pero de pronto el lid sigue disponible"). El DM puede salir
// por lid o por telefono; si la marca se buscara por una sola llave, el DM
// saldria por la otra. Se reconoce por el lid, por el telefono (con el cruce de
// directorio_lids en los dos sentidos) y por el celular que el colega firma en
// su pedido — eso ultimo cubre que publique desde otra cuenta. Un falso
// positivo solo desvia el pedido a la asesora, que es el lado seguro.

function filtroLidsOTelefonos(lids, tels) {
  const partes = [];
  if (lids.size) partes.push(`lid.in.(${[...lids].join(",")})`);
  if (tels.size) partes.push(`telefono.in.(${[...tels].join(",")})`);
  return partes.join(",");
}

/**
 * ¿Este colega pidio que lo contacten solo por llamada?
 * @returns true | false | null — null = no se pudo verificar. Quien llama lo
 *          trata como marcado (no sale DM): FALLA CERRADO. Nunca lanza.
 */
async function esSoloLlamada(orgId, { lid = null, telefono = null, textoPedido = null } = {}) {
  if (!orgId) return null;
  const lids = new Set();
  const tels = new Set();
  const l = soloDigitos(lid);
  if (l) lids.add(l);
  for (const t of [soloDigitos(telefono), telefonoEnTexto(textoPedido)]) {
    if (t && t.length >= 10) for (const v of variantesTelefono(t)) tels.add(v);
  }
  if (!lids.size && !tels.size) return false;

  if (!supabase) {
    for (const d of memory.directorioLids || []) {
      if (d.org_id !== orgId) continue;
      if (lids.has(d.lid)) for (const v of variantesTelefono(d.telefono)) tels.add(v);
      if (tels.has(d.telefono)) lids.add(d.lid);
    }
    return memory.colegasGrupos.some(
      (c) => c.org_id === orgId && c.solo_llamada === true && (lids.has(c.lid) || (c.telefono && tels.has(c.telefono)))
    );
  }

  try {
    const { data: dir, error: e1 } = await supabase
      .from("directorio_lids")
      .select("lid, telefono")
      .eq("org_id", orgId)
      .or(filtroLidsOTelefonos(lids, tels))
      .limit(20);
    if (e1) throw e1;
    for (const d of dir || []) {
      lids.add(d.lid);
      for (const v of variantesTelefono(d.telefono)) tels.add(v);
    }

    const { data, error } = await supabase
      .from("colegas_grupos")
      .select("id")
      .eq("org_id", orgId)
      .eq("solo_llamada", true)
      .or(filtroLidsOTelefonos(lids, tels))
      .limit(1);
    if (error) throw error;
    return (data || []).length > 0;
  } catch (e) {
    console.error(`[colegas] No se pudo verificar si el colega pidio solo llamada (org ${orgId}):`, e.message);
    return null;
  }
}

/**
 * Marca al colega que escribe desde `telefono` como "solo llamada". Lo busca
 * por telefono y, si su fila no lo tiene, por el lid que directorio_lids le
 * asocia. Nunca inventa una fila: sin encontrarlo devuelve no_encontrado.
 */
async function marcarSoloLlamada(orgId, { telefono = null } = {}) {
  const tel = soloDigitos(telefono);
  if (!orgId || !tel || tel.length < 10) return { ok: false, motivo: "sin_telefono" };
  const tels = variantesTelefono(tel);
  const ahora = new Date().toISOString();

  if (!supabase) {
    let fila = memory.colegasGrupos.find((c) => c.org_id === orgId && c.telefono && tels.includes(c.telefono));
    if (!fila) {
      const dir = (memory.directorioLids || []).find((d) => d.org_id === orgId && tels.includes(d.telefono));
      if (dir) fila = memory.colegasGrupos.find((c) => c.org_id === orgId && c.lid === dir.lid);
    }
    if (!fila) return { ok: false, motivo: "no_encontrado" };
    fila.solo_llamada = true;
    fila.solo_llamada_at = ahora;
    return { ok: true, colega: { nombre: fila.nombre || null, telefono: fila.telefono || tel, lid: fila.lid } };
  }

  try {
    let { data: filas, error } = await supabase
      .from("colegas_grupos")
      .select("id, lid, telefono, nombre")
      .eq("org_id", orgId)
      .in("telefono", tels)
      .limit(5);
    if (error) throw error;
    if (!filas || !filas.length) {
      const { data: dir, error: e2 } = await supabase
        .from("directorio_lids")
        .select("lid")
        .eq("org_id", orgId)
        .in("telefono", tels)
        .limit(5);
      if (e2) throw e2;
      const lidsDir = (dir || []).map((d) => d.lid);
      if (lidsDir.length) {
        const r3 = await supabase
          .from("colegas_grupos")
          .select("id, lid, telefono, nombre")
          .eq("org_id", orgId)
          .in("lid", lidsDir)
          .limit(5);
        if (r3.error) throw r3.error;
        filas = r3.data || [];
      }
    }
    if (!filas || !filas.length) return { ok: false, motivo: "no_encontrado" };

    const { error: e4 } = await supabase
      .from("colegas_grupos")
      .update({ solo_llamada: true, solo_llamada_at: ahora })
      .in("id", filas.map((f) => f.id));
    if (e4) throw e4;
    const f = filas[0];
    return { ok: true, colega: { nombre: f.nombre || null, telefono: f.telefono || tel, lid: f.lid } };
  } catch (e) {
    console.error(`[colegas] No se pudo marcar solo llamada (org ${orgId}):`, e.message);
    return { ok: false, motivo: "error" };
  }
}

module.exports = { upsert, porTelefono, listarConTelefono, listarSinTelefono, esSoloLlamada, marcarSoloLlamada };
