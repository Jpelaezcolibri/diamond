// Registro de sesiones (lineas de asesor vinculadas) y de los grupos que esas
// sesiones descubren.
//
// La pieza critica de este modulo es la LISTA BLANCA. Un dispositivo vinculado
// recibe todos los chats del asesor, no solo los grupos — es inherente al
// protocolo de WhatsApp Web, no hay forma de pedirle otra cosa. Lo unico que
// separa "Sofi escucha 3 grupos" de "Sofi lee la vida privada del asesor" es
// que esta consulta corra en la primera linea del webhook y falle CERRADA.

const supabase = require("./supabase");
const memory = require("./memory");

const MODOS = ["ignorar", "sombra", "sugerir"];
const CACHE_MS = 60 * 1000;

// Cache por org. Se refresca sola; el webhook la consulta por mensaje y no
// puede pagar un viaje a Supabase cada vez.
const cache = new Map(); // orgId -> { at, porJid: Map }

function ahora() {
  return Date.now();
}

// ── Sesiones ─────────────────────────────────────────────────────────────

async function upsertSession(orgId, { nombre, advisorId = null, estado = "pendiente" }) {
  if (!supabase) {
    const existente = memory.whatsappSessions.find((s) => s.org_id === orgId && s.nombre === nombre);
    if (existente) return Object.assign(existente, { estado, updated_at: new Date().toISOString() });
    const creada = { id: memory.uid(), org_id: orgId, nombre, advisor_id: advisorId, estado, created_at: new Date().toISOString() };
    memory.whatsappSessions.push(creada);
    return creada;
  }
  const { data, error } = await supabase
    .from("whatsapp_sessions")
    .upsert({ org_id: orgId, nombre, advisor_id: advisorId, estado, updated_at: new Date().toISOString() }, { onConflict: "org_id,nombre" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function listSessions(orgId) {
  if (!supabase) return memory.whatsappSessions.filter((s) => s.org_id === orgId);
  const { data, error } = await supabase.from("whatsapp_sessions").select("*").eq("org_id", orgId).order("created_at");
  if (error) throw error;
  return data;
}

async function touchSession(orgId, nombre) {
  if (!supabase) {
    const s = memory.whatsappSessions.find((x) => x.org_id === orgId && x.nombre === nombre);
    if (s) s.ultima_senal_at = new Date().toISOString();
    return;
  }
  await supabase
    .from("whatsapp_sessions")
    .update({ estado: "activa", ultima_senal_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("nombre", nombre);
}

// ── Grupos ───────────────────────────────────────────────────────────────

// Registra un grupo recien visto. SIEMPRE nace en modo 'ignorar': un grupo
// nuevo —o uno al que el asesor entre manana— no puede filtrarse al sistema
// por olvido. Solo existe lo que Juan prendio a mano.
//
// Si ya existe, NO toca su modo: descubrirlo de nuevo no puede reactivar un
// grupo que alguien apago.
async function registrarGrupo(orgId, { jid, nombre = null }) {
  if (!supabase) {
    const existente = memory.whatsappGroups.find((g) => g.org_id === orgId && g.jid === jid);
    if (existente) {
      if (nombre && !existente.nombre) existente.nombre = nombre;
      return existente;
    }
    const creado = { id: memory.uid(), org_id: orgId, jid, nombre, modo: "ignorar", activo: true, created_at: new Date().toISOString() };
    memory.whatsappGroups.push(creado);
    return creado;
  }

  const { data: existente } = await supabase
    .from("whatsapp_groups").select("*").eq("org_id", orgId).eq("jid", jid).maybeSingle();
  if (existente) {
    if (nombre && !existente.nombre) {
      await supabase.from("whatsapp_groups").update({ nombre }).eq("id", existente.id);
      return { ...existente, nombre };
    }
    return existente;
  }

  const { data, error } = await supabase
    .from("whatsapp_groups")
    .insert({ org_id: orgId, jid, nombre, modo: "ignorar" })
    .select()
    .single();
  if (error) throw error;
  invalidar(orgId);
  return data;
}

async function listGroups(orgId) {
  if (!supabase) {
    return memory.whatsappGroups
      .filter((g) => g.org_id === orgId)
      .sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || "")));
  }
  const { data, error } = await supabase.from("whatsapp_groups").select("*").eq("org_id", orgId).order("nombre");
  if (error) throw error;
  return data;
}

async function setModo(orgId, groupId, modo) {
  if (!MODOS.includes(modo)) throw new Error(`Modo invalido: ${modo}`);
  invalidar(orgId);
  if (!supabase) {
    const g = memory.whatsappGroups.find((x) => x.id === groupId && x.org_id === orgId);
    if (!g) throw new Error("Grupo no encontrado");
    g.modo = modo;
    return g;
  }
  const { data, error } = await supabase
    .from("whatsapp_groups")
    .update({ modo, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", groupId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Lista blanca ─────────────────────────────────────────────────────────

function invalidar(orgId) {
  cache.delete(orgId);
}

// Devuelve Map jid -> {id, modo, nombre} con SOLO los grupos habilitados.
//
// FALLA CERRADA: si la consulta revienta, devuelve un mapa vacio en vez de
// propagar el error. El webhook queda sordo unos segundos —se pierden unos
// mensajes— pero jamas procesa un chat que no deberia. Al reves, un error
// que abriera la puerta seria una fuga silenciosa de los chats privados del
// asesor, y eso no se puede deshacer.
async function whitelist(orgId) {
  const c = cache.get(orgId);
  if (c && ahora() - c.at < CACHE_MS) return c.porJid;

  const porJid = new Map();
  try {
    const grupos = !supabase
      ? memory.whatsappGroups.filter((g) => g.org_id === orgId)
      : (await supabase.from("whatsapp_groups").select("id, jid, nombre, modo, activo").eq("org_id", orgId)).data || [];

    for (const g of grupos) {
      if (!g.activo || g.modo === "ignorar") continue;
      porJid.set(g.jid, { id: g.id, modo: g.modo, nombre: g.nombre });
    }
    cache.set(orgId, { at: ahora(), porJid });
  } catch (e) {
    console.error("[grupos] No se pudo cargar la lista blanca, quedamos sordos:", e.message);
    return new Map(); // sin cachear: se reintenta al proximo mensaje
  }
  return porJid;
}

module.exports = {
  upsertSession, listSessions, touchSession,
  registrarGrupo, listGroups, setModo,
  whitelist, invalidar, MODOS,
};
