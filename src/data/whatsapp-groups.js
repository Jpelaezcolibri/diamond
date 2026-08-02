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
const { plano } = require("../groups/texto");

const MODOS = ["ignorar", "sombra", "sugerir"];
const CACHE_MS = 60 * 1000;

// Cache por org. Se refresca sola; el webhook la consulta por mensaje y no
// puede pagar un viaje a Supabase cada vez.
const cache = new Map(); // orgId -> { at, porJid: Map }

function ahora() {
  return Date.now();
}

// ── Sesiones ─────────────────────────────────────────────────────────────

// escucha_desde se fija UNA vez, al crear la sesion, y no se vuelve a tocar:
// es el corte temporal. Al vincular un dispositivo WhatsApp puede sincronizar
// historial, y ese historial es veneno — una propiedad de hace tres meses casi
// seguro ya se vendio, y recomendarsela a un cliente real es dano de
// reputacion. Reescribirlo en cada arranque abriria la puerta a reprocesar.
// `reiniciarCorte` mueve escucha_desde a este instante. Se usa SOLO al volver a
// parear: WhatsApp le resincroniza el historial al dispositivo nuevo, y sin
// mover el corte entraria todo lo publicado desde el pareo anterior — mensajes
// viejos, de propiedades que ya no se sabe si estan disponibles, pagando IA por
// clasificarlos. La regla del negocio es que solo cuenta lo de hoy en adelante.
async function upsertSession(orgId, { nombre, advisorId = null, estado = "pendiente", reiniciarCorte = false }) {
  const ahoraIso = new Date().toISOString();
  cacheSesiones.delete(`${orgId}:${nombre}`);

  if (!supabase) {
    const existente = memory.whatsappSessions.find((s) => s.org_id === orgId && s.nombre === nombre);
    if (existente) {
      return Object.assign(existente, {
        estado,
        updated_at: ahoraIso,
        ...(reiniciarCorte ? { escucha_desde: ahoraIso } : {}),
      });
    }
    const creada = { id: memory.uid(), org_id: orgId, nombre, advisor_id: advisorId, estado, escucha_desde: ahoraIso, created_at: ahoraIso };
    memory.whatsappSessions.push(creada);
    return creada;
  }

  const { data: existente } = await supabase
    .from("whatsapp_sessions").select("*").eq("org_id", orgId).eq("nombre", nombre).maybeSingle();

  const patch = { org_id: orgId, nombre, estado, updated_at: ahoraIso };
  if (advisorId) patch.advisor_id = advisorId;
  if (reiniciarCorte || !existente?.escucha_desde) patch.escucha_desde = ahoraIso;

  const { data, error } = await supabase
    .from("whatsapp_sessions")
    .upsert(patch, { onConflict: "org_id,nombre" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Cache de sesiones para el corte temporal del webhook: se consulta por
// mensaje y no puede pagar un viaje a Supabase cada vez.
const cacheSesiones = new Map(); // `${orgId}:${nombre}` -> { at, sesion }

async function sesionPorNombre(orgId, nombre) {
  if (!nombre) return null;
  const clave = `${orgId}:${nombre}`;
  const c = cacheSesiones.get(clave);
  if (c && ahora() - c.at < CACHE_MS) return c.sesion;

  let sesion = null;
  try {
    sesion = !supabase
      ? memory.whatsappSessions.find((s) => s.org_id === orgId && s.nombre === nombre) || null
      : (await supabase.from("whatsapp_sessions").select("id, nombre, escucha_desde, advisor_id").eq("org_id", orgId).eq("nombre", nombre).maybeSingle()).data;
  } catch (e) {
    console.error("[grupos] No se pudo leer la sesión:", e.message);
    return null; // falla cerrada: sin sesión conocida no se procesa nada
  }
  cacheSesiones.set(clave, { at: ahora(), sesion });
  return sesion;
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

// Prender un grupo fija su escucha_desde en ESE momento. Prender hoy un grupo
// no puede arrastrar lo que se hablo ahi la semana pasada: apagarlo y volverlo
// a prender vuelve a correr el corte hacia adelante, nunca hacia atras.
async function setModo(orgId, groupId, modo) {
  if (!MODOS.includes(modo)) throw new Error(`Modo invalido: ${modo}`);
  invalidar(orgId);
  const ahoraIso = new Date().toISOString();
  const patch = { modo, updated_at: ahoraIso };
  if (modo !== "ignorar") patch.escucha_desde = ahoraIso;

  if (!supabase) {
    const g = memory.whatsappGroups.find((x) => x.id === groupId && x.org_id === orgId);
    if (!g) throw new Error("Grupo no encontrado");
    return Object.assign(g, patch);
  }
  const { data, error } = await supabase
    .from("whatsapp_groups")
    .update(patch)
    .eq("org_id", orgId)
    .eq("id", groupId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Alta masiva de los grupos que devuelve WAHA. Nacen todos en 'ignorar' — que
// se importen no significa que se escuchen. Si ya existia, solo se completa el
// nombre: NUNCA se toca el modo ni el corte temporal de uno ya configurado.
async function importarGrupos(orgId, grupos) {
  let nuevos = 0;
  for (const g of grupos) {
    if (!g.jid) continue;
    const antes = !supabase
      ? memory.whatsappGroups.find((x) => x.org_id === orgId && x.jid === g.jid)
      : (await supabase.from("whatsapp_groups").select("id").eq("org_id", orgId).eq("jid", g.jid).maybeSingle()).data;
    await registrarGrupo(orgId, { jid: g.jid, nombre: g.nombre });
    if (!antes) nuevos++;
  }
  invalidar(orgId);
  return { total: grupos.length, nuevos };
}

// ── Grupos virtuales ─────────────────────────────────────────────────────
//
// Un mensaje que llega por export o por reenvio no tiene jid: nadie vinculo
// una linea, que es justamente el punto. Pero `group_signals.group_id` es una
// FK obligatoria — y esta bien que lo sea, porque una senal sin grupo no se
// puede rastrear hasta su origen.
//
// La solucion es un grupo con jid sintetico y prefijo de procedencia. Se ve
// igual que uno real en el CRM y el asesor sabe de donde salio cada senal.
// Idempotente: `registrarGrupo` ya resuelve por (org_id, jid).

function slug(texto) {
  return plano(texto)
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 60) || "sin-nombre";
}

function jidVirtual(prefijo, nombre) {
  return `${prefijo}:${slug(nombre)}`;
}

async function asegurarGrupoVirtual(orgId, { prefijo, nombre }) {
  return registrarGrupo(orgId, { jid: jidVirtual(prefijo, nombre), nombre });
}

// ── Lista blanca ─────────────────────────────────────────────────────────

function invalidar(orgId) {
  cache.delete(orgId);
  for (const k of [...cacheSesiones.keys()]) if (k.startsWith(`${orgId}:`)) cacheSesiones.delete(k);
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
      : (await supabase.from("whatsapp_groups").select("id, jid, nombre, modo, activo, escucha_desde").eq("org_id", orgId)).data || [];

    for (const g of grupos) {
      if (!g.activo || g.modo === "ignorar") continue;
      porJid.set(g.jid, { id: g.id, modo: g.modo, nombre: g.nombre, escuchaDesde: g.escucha_desde || null });
    }
    cache.set(orgId, { at: ahora(), porJid });
  } catch (e) {
    console.error("[grupos] No se pudo cargar la lista blanca, quedamos sordos:", e.message);
    return new Map(); // sin cachear: se reintenta al proximo mensaje
  }
  return porJid;
}

module.exports = {
  upsertSession, listSessions, touchSession, sesionPorNombre,
  registrarGrupo, listGroups, setModo, importarGrupos,
  asegurarGrupoVirtual, jidVirtual, slug,
  whitelist, invalidar, MODOS,
};
