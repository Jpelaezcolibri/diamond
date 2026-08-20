// Sesiones (lineas vinculadas) y los grupos que esas sesiones descubren.
//
// La pieza critica es la LISTA BLANCA. Un dispositivo vinculado recibe todos
// los chats de la linea, no solo los grupos — es inherente al protocolo de
// WhatsApp Web, no hay forma de pedirle otra cosa. Lo unico que separa "el
// radar escucha 2 grupos" de "el radar lee todo lo que le llega a esa linea" es
// que esta consulta corra en la primera linea del webhook y FALLE CERRADA.
//
// DOS PERMISOS, NO UNO (2026-08-16). Escuchar un grupo y responder en el son
// decisiones distintas:
//
//   modo != 'ignorar'  ->  se procesan sus mensajes (alimenta el digest)
//   responde = true    ->  ademas, el radar puede publicar ahi
//
// `responde` arranca en false y no lo mueve ninguna importacion. Importar una
// linea trae de golpe TODOS sus grupos —la asesora de julio tenia 80— y sin
// esta separacion un solo clic pondria al bot a hablar en ochenta grupos
// gremiales a la vez.
//
// Los grupos con jid 'export:' o 'reenvio:' son virtuales: no hay linea
// vinculada detras, los trae una persona a mano.

const supabase = require("./supabase");
const memory = require("./memory");
const { plano } = require("../groups/texto");

const MODOS = ["ignorar", "sombra", "sugerir"];
const CACHE_MS = 60 * 1000;

// Cache por org. El webhook la consulta por mensaje y no puede pagar un viaje
// a Supabase cada vez.
const cache = new Map(); // orgId -> { at, porJid: Map }
const cacheSesiones = new Map(); // `${orgId}:${nombre}` -> { at, sesion }

function ahora() {
  return Date.now();
}

// ── Sesiones ─────────────────────────────────────────────────────────────

// escucha_desde se fija UNA vez, al crear la sesion, y no se vuelve a tocar:
// es el corte temporal. Al vincular un dispositivo WhatsApp puede sincronizar
// historial, y ese historial es veneno — una propiedad de hace tres meses casi
// seguro ya se vendio, y ofrecerla en un grupo gremial es dano de reputacion.
//
// `reiniciarCorte` lo mueve a este instante. Se usa SOLO al volver a parear:
// WhatsApp le resincroniza el historial al dispositivo nuevo, y sin mover el
// corte entraria todo lo publicado desde el pareo anterior.
//
// `rol` distingue la linea dedicada (sacrificable) de la de una persona. La
// regla que costo una cuenta el 2026-07-30 es que nunca se vincula la linea de
// un asesor ni la que atiende clientes; anotarlo en la fila evita que la regla
// viva solo en la cabeza de alguien.
async function upsertSession(orgId, { nombre, advisorId = null, estado = "pendiente", rol = "dedicada", reiniciarCorte = false }) {
  const ahoraIso = new Date().toISOString();
  cacheSesiones.delete(`${orgId}:${nombre}`);

  if (!supabase) {
    const existente = memory.whatsappSessions.find((s) => s.org_id === orgId && s.nombre === nombre);
    if (existente) {
      return Object.assign(existente, {
        estado,
        rol,
        updated_at: ahoraIso,
        ...(reiniciarCorte ? { escucha_desde: ahoraIso } : {}),
      });
    }
    const creada = { id: memory.uid(), org_id: orgId, nombre, advisor_id: advisorId, estado, rol, escucha_desde: ahoraIso, created_at: ahoraIso };
    memory.whatsappSessions.push(creada);
    return creada;
  }

  const { data: existente } = await supabase
    .from("whatsapp_sessions").select("*").eq("org_id", orgId).eq("nombre", nombre).maybeSingle();

  const patch = { org_id: orgId, nombre, estado, rol, updated_at: ahoraIso };
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

async function sesionPorNombre(orgId, nombre) {
  if (!nombre) return null;
  const clave = `${orgId}:${nombre}`;
  const c = cacheSesiones.get(clave);
  if (c && ahora() - c.at < CACHE_MS) return c.sesion;

  let sesion = null;
  try {
    sesion = !supabase
      ? memory.whatsappSessions.find((s) => s.org_id === orgId && s.nombre === nombre) || null
      : (await supabase.from("whatsapp_sessions").select("id, nombre, escucha_desde, advisor_id, rol").eq("org_id", orgId).eq("nombre", nombre).maybeSingle()).data;
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

// Registra un grupo recien visto. SIEMPRE nace en 'ignorar' y con responde en
// false: un grupo nuevo —o uno al que la linea entre manana— no puede filtrarse
// al sistema por olvido, y mucho menos empezar a recibir mensajes del bot.
//
// Si ya existe, NO toca su modo ni su permiso: descubrirlo de nuevo no puede
// reactivar un grupo que alguien apago.
async function registrarGrupo(orgId, { jid, nombre = null }) {
  if (!supabase) {
    const existente = memory.whatsappGroups.find((g) => g.org_id === orgId && g.jid === jid);
    if (existente) {
      if (nombre && !existente.nombre) existente.nombre = nombre;
      return existente;
    }
    const creado = { id: memory.uid(), org_id: orgId, jid, nombre, modo: "ignorar", responde: false, activo: true, created_at: new Date().toISOString() };
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
  return data;
}

// Un grupo por su id — lo que necesita la aprobacion manual (Juan,
// 2026-08-20) para saber a que jid publicarle sin traer la lista entera.
async function obtenerGrupo(orgId, groupId) {
  if (!supabase) return memory.whatsappGroups.find((g) => g.org_id === orgId && g.id === groupId) || null;
  const { data, error } = await supabase
    .from("whatsapp_groups").select("id, jid, nombre, responde, modo").eq("org_id", orgId).eq("id", groupId).maybeSingle();
  if (error) throw error;
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
// a prender corre el corte hacia adelante, nunca hacia atras.
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
    .from("whatsapp_groups").update(patch).eq("org_id", orgId).eq("id", groupId).select().single();
  if (error) throw error;
  return data;
}

// El permiso de PUBLICAR en un grupo. Deliberadamente separado de setModo: son
// dos decisiones de riesgo distinto y no se toman juntas por accidente.
//
// Habilitar el envio exige que el grupo ya se este escuchando. Al reves no
// tiene sentido —no se puede responder lo que no se lee— y ademas obliga a
// pasar por el paso barato antes que por el caro.
async function setResponde(orgId, groupId, responde) {
  invalidar(orgId);
  const patch = { responde: Boolean(responde), updated_at: new Date().toISOString() };

  if (!supabase) {
    const g = memory.whatsappGroups.find((x) => x.id === groupId && x.org_id === orgId);
    if (!g) throw new Error("Grupo no encontrado");
    if (patch.responde && g.modo === "ignorar") throw new Error("El grupo tiene que estar escuchandose antes de poder responder en el");
    return Object.assign(g, patch);
  }

  const { data: actual } = await supabase
    .from("whatsapp_groups").select("modo").eq("org_id", orgId).eq("id", groupId).maybeSingle();
  if (!actual) throw new Error("Grupo no encontrado");
  if (patch.responde && actual.modo === "ignorar") {
    throw new Error("El grupo tiene que estar escuchandose antes de poder responder en el");
  }

  const { data, error } = await supabase
    .from("whatsapp_groups").update(patch).eq("org_id", orgId).eq("id", groupId).select().single();
  if (error) throw error;
  return data;
}

// Alta masiva de los grupos que devuelve WAHA. Nacen todos en 'ignorar' y sin
// permiso de responder — que se importen no significa que se escuchen, y
// escucharlos no significa que se conteste. Si ya existia, solo se completa el
// nombre: NUNCA se toca el modo, el permiso ni el corte temporal.
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
// Un mensaje que llega por export o por reenvio no tiene jid: nadie vinculo una
// linea, que es justamente el punto. Pero `group_signals.group_id` es una FK
// obligatoria — y esta bien que lo sea, porque una senal sin grupo no se puede
// rastrear hasta su origen. La solucion es un grupo con jid sintetico y prefijo
// de procedencia.

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

// Devuelve Map jid -> {id, modo, nombre, responde, escuchaDesde} con SOLO los
// grupos habilitados para escuchar.
//
// FALLA CERRADA: si la consulta revienta devuelve un mapa vacio en vez de
// propagar el error. El webhook queda sordo unos segundos —se pierden unos
// mensajes— pero jamas procesa un chat que no deberia. Al reves, un error que
// abriera la puerta seria una fuga silenciosa de los chats de esa linea, y eso
// no se puede deshacer.
//
// `responde` viaja aca porque la politica lo necesita por mensaje y no puede
// pagar otra consulta.
async function whitelist(orgId) {
  const c = cache.get(orgId);
  if (c && ahora() - c.at < CACHE_MS) return c.porJid;

  const porJid = new Map();
  try {
    const grupos = !supabase
      ? memory.whatsappGroups.filter((g) => g.org_id === orgId)
      : (await supabase.from("whatsapp_groups").select("id, jid, nombre, modo, activo, responde, escucha_desde").eq("org_id", orgId)).data || [];

    for (const g of grupos) {
      if (!g.activo || g.modo === "ignorar") continue;
      porJid.set(g.jid, {
        id: g.id,
        modo: g.modo,
        nombre: g.nombre,
        // Si la migracion 2026-08-16 no corrio todavia, la columna no viene y
        // esto queda en false: sin poder verificar el permiso, no se responde.
        responde: g.responde === true,
        escuchaDesde: g.escucha_desde || null,
      });
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
  registrarGrupo, listGroups, obtenerGrupo, setModo, setResponde, importarGrupos,
  asegurarGrupoVirtual, jidVirtual, slug,
  whitelist, invalidar,
};
