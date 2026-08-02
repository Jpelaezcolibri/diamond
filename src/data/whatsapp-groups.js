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
//
// Por eso este modulo quedo en tres funciones. `listGroups` y `setModo` se
// eliminaron el 2026-08-02: no tenian un solo llamador desde que se retiro
// WAHA, y sostenian ese modelo de lista blanca que ya no existe. El CRM lee
// los grupos directo de Supabase.

const supabase = require("./supabase");
const memory = require("./memory");
const { plano } = require("../groups/texto");

// ── Grupos ───────────────────────────────────────────────────────────────

// Registra un grupo recien visto, o devuelve el que ya estaba. Idempotente por
// (org_id, jid).
//
// La columna `modo` sigue existiendo en la tabla y todo grupo nace en
// 'ignorar', pero ya no significa nada: decidia que chats escuchaba la sesion
// en vivo, y esa sesion no existe. Se deja el default para no tocar el
// constraint de la base.
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

// `registrarGrupo` no se exporta: su unico llamador es `asegurarGrupoVirtual`,
// aca al lado. Exportarlo seria API publica sin consumidor.
module.exports = { asegurarGrupoVirtual, jidVirtual, slug };
