// Senales detectadas en los grupos: SOLO demanda y oferta.
//
// Lo clasificado como ruido no llega nunca hasta aca — muere en memoria en el
// worker (invariante de privacidad #4 del diseno). Este modulo no tiene forma
// de guardar un mensaje que no sea senal, y eso es a proposito.

const supabase = require("./supabase");
const memory = require("./memory");

const CLASES = ["demanda", "oferta"];
const ORIGENES = ["vivo", "export", "reenvio"];

// Columnas de la migracion 2026-08-01_radar_grupos.sql. Si no corrio todavia,
// el insert las rechaza y se reintenta sin ellas: una senal guardada sin
// `origen` vale mucho mas que una senal perdida. Se avisa una sola vez para
// no llenar los logs.
const COLUMNAS_NUEVAS = ["origen", "fecha_mensaje"];
let faltanColumnas = false;

// PGRST204: PostgREST no encuentra la columna en su cache de esquema.
// 42703: Postgres dice que la columna no existe.
function esColumnaFaltante(error) {
  return error?.code === "PGRST204" || error?.code === "42703";
}

// Alta con deduplicacion. El mismo mensaje visto por dos asesores del mismo
// grupo trae el mismo wa_message_id: sin esto se paga la IA dos veces y —en
// Fase 2— el asesor recibe la alerta duplicada.
//
// Devuelve {signal, duplicado}.
async function create(orgId, fields) {
  if (!CLASES.includes(fields.clase)) throw new Error(`Clase invalida: ${fields.clase}`);
  const origen = fields.origen || "vivo";
  if (!ORIGENES.includes(origen)) throw new Error(`Origen invalido: ${origen}`);

  const row = {
    org_id: orgId,
    group_id: fields.group_id,
    wa_message_id: fields.wa_message_id,
    autor_nombre: fields.autor_nombre || null,
    autor_telefono: fields.autor_telefono || null,
    clase: fields.clase,
    confianza: fields.confianza ?? null,
    operacion: fields.operacion || null,
    tipo: fields.tipo || null,
    zona: fields.zona || null,
    ciudad: fields.ciudad || null,
    precio_min: fields.precio_min || null,
    precio_max: fields.precio_max || null,
    habitaciones: fields.habitaciones || null,
    contacto: fields.contacto || null,
    texto_original: fields.texto_original || null,
    matches: fields.matches || [],
    estado: "nuevo",
    origen,
    // La fecha REAL del mensaje en el grupo. En un export los mensajes son de
    // hace dias o semanas y created_at diria "hoy" para todos: sin esto no se
    // puede distinguir una demanda de ayer de una de hace un mes, y una
    // demanda vieja no vale — el colega ya consiguio lo que buscaba.
    fecha_mensaje: fields.fecha_mensaje || null,
  };

  if (!supabase) {
    const yaEsta = memory.groupSignals.find(
      (s) => s.org_id === orgId && s.group_id === row.group_id && s.wa_message_id === row.wa_message_id
    );
    if (yaEsta) return { signal: yaEsta, duplicado: true };
    const creada = { id: memory.uid(), created_at: new Date().toISOString(), ...row };
    memory.groupSignals.push(creada);
    return { signal: creada, duplicado: false };
  }

  return insertar(row);
}

async function insertar(row) {
  // Si ya sabemos que la migracion no corrio, ni lo intentamos con las
  // columnas nuevas.
  const fila = faltanColumnas ? sinColumnasNuevas(row) : row;

  const { data, error } = await supabase.from("group_signals").insert(fila).select().single();
  if (!error) return { signal: data, duplicado: false };

  // 23505 = violacion de indice unico: es el dedup haciendo su trabajo, no
  // un fallo. Cualquier otro error si se propaga.
  if (error.code === "23505") return { signal: null, duplicado: true };

  if (esColumnaFaltante(error) && !faltanColumnas) {
    faltanColumnas = true;
    console.warn(
      "[grupos] Falta correr db/migrations/2026-08-01_radar_grupos.sql — " +
      "las señales se guardan sin origen ni fecha_mensaje hasta entonces."
    );
    return insertar(row);
  }
  throw error;
}

function sinColumnasNuevas(row) {
  const copia = { ...row };
  for (const c of COLUMNAS_NUEVAS) delete copia[c];
  return copia;
}

async function list(orgId, { clase = null, estado = null, limit = 200 } = {}) {
  if (!supabase) {
    return memory.groupSignals
      .filter((s) => s.org_id === orgId && (!clase || s.clase === clase) && (!estado || s.estado === estado))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, limit);
  }
  let q = supabase.from("group_signals").select("*").eq("org_id", orgId);
  if (clase) q = q.eq("clase", clase);
  if (estado) q = q.eq("estado", estado);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}

async function setEstado(orgId, id, estado) {
  if (!["nuevo", "gestionado", "descartado"].includes(estado)) throw new Error(`Estado invalido: ${estado}`);
  if (!supabase) {
    const s = memory.groupSignals.find((x) => x.id === id && x.org_id === orgId);
    if (!s) throw new Error("Senal no encontrada");
    s.estado = estado;
    return s;
  }
  const { data, error } = await supabase
    .from("group_signals")
    .update({ estado, updated_at: new Date().toISOString() })
    .eq("org_id", orgId).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

// Metricas del modo sombra: lo que Juan mira para decidir si pasar a Fase 2.
async function resumen(orgId, { dias = 14 } = {}) {
  const desde = new Date(Date.now() - dias * 86400000).toISOString();
  const filas = !supabase
    ? memory.groupSignals.filter((s) => s.org_id === orgId && s.created_at >= desde)
    : (await supabase.from("group_signals").select("clase, matches, created_at").eq("org_id", orgId).gte("created_at", desde)).data || [];

  const demandas = filas.filter((s) => s.clase === "demanda");
  const ofertas = filas.filter((s) => s.clase === "oferta");
  const conMatch = demandas.filter((s) => (s.matches || []).length > 0).length;

  return {
    dias,
    demandas: demandas.length,
    ofertas: ofertas.length,
    demandasConMatch: conMatch,
    demandasPorDia: demandas.length / dias,
    ofertasPorDia: ofertas.length / dias,
    tasaMatch: demandas.length === 0 ? 0 : conMatch / demandas.length,
  };
}

// ── Digest diario ────────────────────────────────────────────────────────

// Lo que todavia no se conto en ningun digest y vale la pena contar.
//
// Filtra en la consulta y no en memoria porque esta tabla crece sin techo:
// el indice parcial `group_signals_digest_pend` existe justo para esto.
//
// "Vale la pena contar" = una demanda que calzo con algo, o una oferta (que
// siempre suma inventario). Una demanda sin match no se cuenta: es la fatiga
// de alertas, que es el riesgo principal de esta direccion.
async function pendientesDigest(orgId, { limit = 200 } = {}) {
  if (!supabase) {
    return memory.groupSignals
      .filter((s) => s.org_id === orgId && !s.digest_enviado_at && !s.digest_omitida)
      .filter((s) => s.clase === "oferta" || (s.matches || []).length > 0)
      .slice(0, limit);
  }
  const { data, error } = await supabase
    .from("group_signals")
    .select("*")
    .eq("org_id", orgId)
    .is("digest_enviado_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (esColumnaFaltante(error)) return null; // el worker se auto-desactiva
    throw error;
  }
  return (data || []).filter((s) => s.clase === "oferta" || (s.matches || []).length > 0);
}

// Se marca ANTES de enviar. Duplicarle el digest a un asesor entrena a
// ignorarlo; perderlo una vez no.
async function marcarDigest(orgId, ids) {
  if (!ids.length) return;
  const ahora = new Date().toISOString();
  if (!supabase) {
    for (const s of memory.groupSignals) if (ids.includes(s.id)) s.digest_enviado_at = ahora;
    return;
  }
  const { error } = await supabase
    .from("group_signals").update({ digest_enviado_at: ahora }).eq("org_id", orgId).in("id", ids);
  if (error) throw error;
}

async function revertirDigest(orgId, ids) {
  if (!ids.length) return;
  if (!supabase) {
    for (const s of memory.groupSignals) if (ids.includes(s.id)) s.digest_enviado_at = null;
    return;
  }
  const { error } = await supabase
    .from("group_signals").update({ digest_enviado_at: null }).eq("org_id", orgId).in("id", ids);
  if (error) console.error("[digest] No se pudo revertir el claim:", error.message);
}

// Deja constancia de que el aviso al asesor SALIO.
//
// Sin esto la pregunta "¿le llego la alerta a la asesora?" no tiene respuesta:
// el envio no dejaba rastro en ningun lado, ni en la tabla ni en los logs, asi
// que un fallo silencioso de Meta era indistinguible de un exito. Se identifica
// por (grupo, wa_message_id) porque es la clave que el flujo ya tiene a mano.
async function marcarEnviada(orgId, groupId, waMessageId) {
  if (!supabase) return;
  const { error } = await supabase
    .from("group_signals")
    .update({ enviado_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("group_id", groupId)
    .eq("wa_message_id", waMessageId);
  if (error) console.error("[grupos] No se pudo marcar la señal como enviada:", error.message);
}

module.exports = {
  create, list, setEstado, resumen, marcarEnviada,
  pendientesDigest, marcarDigest, revertirDigest,
  CLASES, ORIGENES, _resetBlindaje,
};

// Solo para tests: el flag de "falta la migracion" es de proceso.
function _resetBlindaje() {
  faltanColumnas = false;
}
