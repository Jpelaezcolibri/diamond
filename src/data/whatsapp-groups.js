// Los grupos de los que salen las señales.
//
// Un grupo es el contenedor al que se le cuelgan las señales, para poder
// rastrear de donde salio cada pedido. Se distinguen por el prefijo del jid:
//
//   'export:'  — se crea al subir el .txt de un grupo desde el CRM.
//   'reenvio:' — el buzon de lo que los asesores le reenvian a Sofi.
//
// Los que tienen un jid real de WhatsApp son historicos: quedaron de la
// escucha en vivo via WAHA, retirada el 2026-07-30 cuando WhatsApp baneo la
// linea de la asesora pareada. Con ella se fueron las sesiones y la lista
// blanca, que existian para decidir que chats se escuchaban. Hoy no se escucha
// nada: los mensajes los trae una persona, a mano.

const supabase = require("./supabase");
const memory = require("./memory");
const { plano } = require("../groups/texto");

const MODOS = ["ignorar", "sombra", "sugerir"];
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

module.exports = {
  registrarGrupo, listGroups, setModo,
  asegurarGrupoVirtual, jidVirtual, slug, MODOS,
};
