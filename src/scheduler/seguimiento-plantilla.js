// Seguimiento de Sofi al cliente PASADA la ventana de 24 h — Fase 2 de
// diamond-os/sofi-conversacion-2.0.md (Juan, 2026-10-17: "necesitamos que se
// haga seguimiento a todos los mensajes que enviemos").
//
// Dentro de la ventana, followups.js hace UN toque con texto libre. Pasadas
// 24 h sin que el cliente escriba, WhatsApp solo deja escribir con plantilla:
// aca van dos toques con `seguimiento_cliente` — a las 48 h de silencio y 7
// dias despues del primero — y nada mas.
//
// Nunca: a quien dijo que no ("ya consegui", "no gracias"), a un colega (tiene
// su propio seguimiento, seguimiento-colega.js), a un asesor, a un chat que ya
// esta con una asesora (transferido) o cerrado, ni de noche. Solo se marca el
// paso si la plantilla salio: si Meta la rechaza, se reintenta la proxima vuelta.
//
// Interruptor: SOFI_SEGUIMIENTO_PLANTILLA=false.

const { hourInBogota, inQuietHours } = require("./followups");

const H = 60 * 60 * 1000;
const PLANTILLA = process.env.SOFI_SEGUIMIENTO_PLANTILLA_NOMBRE || "seguimiento_cliente";
const VALORES_APAGADO = new Set(["false", "0", "no", "off"]);
const ESTADOS_OK = new Set(["nuevo", "en_conversacion", "calificado"]);
const SOURCES_FUERA = new Set(["colega", "asesor"]);
// Un "no" del cliente cierra el seguimiento.
const DIJO_QUE_NO = /\b(no\s+gracias|ya\s+(consegu|compr|arrend|tengo|encontr|no\s+me\s+interesa)|no\s+me\s+interesa|no\s+estoy\s+interesad|already\s+have|not\s+interested|no\s+thanks)/i;
const SILENCIO_T48 = 48 * H;
const ENTRE_TOQUES = 7 * 24 * H;
const ANTIGUEDAD_MAX = 15 * 24 * H; // no despertar chats de hace meses

let enviadosEsteProceso = new Set();

function activo() {
  return !VALORES_APAGADO.has(String(process.env.SOFI_SEGUIMIENTO_PLANTILLA ?? "").trim().toLowerCase());
}

function contextoDe(lead = {}) {
  if (lead.property_ref_origen) return `la propiedad ref ${lead.property_ref_origen}`;
  if (lead.tipo_interes && lead.zona_interes) return `${lead.tipo_interes} en ${lead.zona_interes}`;
  if (lead.zona_interes) return `propiedad en ${lead.zona_interes}`;
  return "tu próxima propiedad";
}

function textoDe(contexto) {
  return `Hola, soy Sofi de Diamond Inmobiliaria 😊 Te escribo para saber si sigues buscando ${contexto}. Si quieres, te comparto opciones nuevas o te agendo una visita. ¿Te ayudo?`;
}

/** "t48" | "t7d" | null */
function pasoPendiente({ lead, ultimo, ultimoCliente, ultimosCliente = [] }, ahora = new Date()) {
  if (!lead || SOURCES_FUERA.has(lead.source) || !ESTADOS_OK.has(lead.estado)) return null;
  if (!ultimo || ultimo.role !== "assistant") return null;
  // El "no" puede no ser el ultimo mensaje: "ya consegui gracias" + "Ok listo".
  const delCliente = [ultimoCliente, ...ultimosCliente].filter(Boolean);
  if (delCliente.some((m) => DIJO_QUE_NO.test(String(m.content || "")))) return null;
  const seg = lead.seguimiento || {};
  const silencio = ahora.getTime() - new Date(ultimo.created_at).getTime();
  if (!seg.t48_sent_at) return silencio >= SILENCIO_T48 && silencio <= ANTIGUEDAD_MAX ? "t48" : null;
  if (!seg.t7d_sent_at) return ahora.getTime() - new Date(seg.t48_sent_at).getTime() >= ENTRE_TOQUES ? "t7d" : null;
  return null;
}

function depsPorDefecto() {
  return {
    orgs: () => require("../data/organizations").listActive(),
    candidatos: (org, ahora) => cargarCandidatos(org, ahora),
    enviar: (org, tel, plantilla, fromPhoneId) => require("../channels/whatsapp").sendWhatsAppTemplate(org, tel, { ...plantilla, fromPhoneId }),
    registrar: (convId, texto) => require("../data/conversations").appendMessage(convId, "assistant", texto),
    marcar: async (leadId, paso) => {
      const leads = require("../data/leads");
      const supabase = require("../data/supabase");
      const { data } = supabase ? await supabase.from("leads").select("seguimiento").eq("id", leadId).single() : { data: null };
      await leads.update(leadId, { seguimiento: { ...((data && data.seguimiento) || {}), [`${paso}_sent_at`]: new Date().toISOString() } });
      return true;
    },
  };
}

async function cargarCandidatos(org, ahora) {
  const supabase = require("../data/supabase");
  if (!supabase) return [];
  const conversations = require("../data/conversations");
  const { data, error } = await supabase
    .from("conversations")
    .select("id, whatsapp_phone_id, leads!inner(*)")
    .eq("org_id", org.id)
    .eq("estado", "activa")
    .or("modo.is.null,modo.eq.bot")
    .lte("last_activity_at", new Date(ahora.getTime() - SILENCIO_T48).toISOString())
    .gte("last_activity_at", new Date(ahora.getTime() - ANTIGUEDAD_MAX - ENTRE_TOQUES).toISOString())
    .in("leads.estado", [...ESTADOS_OK])
    .limit(100);
  if (error) throw error;
  const out = [];
  for (const c of data || []) {
    const ultimo = await conversations.lastMessage(c.id);
    const { data: u } = await supabase
      .from("messages").select("content, created_at").eq("conversation_id", c.id).eq("role", "user")
      .order("created_at", { ascending: false }).limit(3);
    out.push({ id: c.id, whatsapp_phone_id: c.whatsapp_phone_id, lead: c.leads, ultimo, ultimoCliente: (u && u[0]) || null, ultimosCliente: u || [] });
  }
  return out;
}

async function runOnce({ ahora = new Date(), deps = null } = {}) {
  if (!activo()) return { enviados: 0 };
  if (inQuietHours(hourInBogota(ahora), { quietStartHour: 20, quietEndHour: 8 })) return { enviados: 0, quiet: true };
  const d = deps || depsPorDefecto();
  let enviados = 0;
  for (const org of await d.orgs()) {
    let candidatos = [];
    try {
      candidatos = await d.candidatos(org, ahora);
    } catch (e) {
      console.error(`[seguimiento-plantilla] ${org.name}: no se pudieron leer candidatos:`, e.message);
      continue;
    }
    for (const c of candidatos) {
      const paso = pasoPendiente(c, ahora);
      if (!paso || enviadosEsteProceso.has(`${c.lead.id}:${paso}`)) continue;
      const contexto = contextoDe(c.lead);
      const r = await d
        .enviar(org, c.lead.phone, { name: PLANTILLA, bodyParams: [contexto] }, c.whatsapp_phone_id)
        .catch((e) => ({ ok: false, error: e.message }));
      if (!r || !r.ok) {
        console.warn(`[seguimiento-plantilla] no salió a +${c.lead.phone}: ${r && r.error}`);
        continue;
      }
      enviadosEsteProceso.add(`${c.lead.id}:${paso}`);
      await d.registrar(c.id, textoDe(contexto)).catch(() => {});
      await d.marcar(c.lead.id, paso).catch((e) => console.warn("[seguimiento-plantilla] no se pudo marcar:", e.message));
      enviados++;
      console.log(`[seguimiento-plantilla] ${paso} a +${c.lead.phone} (${contexto})`);
    }
  }
  return { enviados };
}

function start() {
  if (!activo()) {
    console.log("[seguimiento-plantilla] apagado (SOFI_SEGUIMIENTO_PLANTILLA=false)");
    return;
  }
  const tick = () => runOnce().catch((e) => console.error("[seguimiento-plantilla] runOnce:", e.message));
  setTimeout(tick, 3 * 60 * 1000);
  setInterval(tick, 60 * 60 * 1000);
  console.log("[seguimiento-plantilla] activo — toques a las 48 h y a los 7 días, 8am-8pm");
}

function _reset() {
  enviadosEsteProceso = new Set();
}

module.exports = { start, runOnce, pasoPendiente, contextoDe, textoDe, _reset, __cargar: cargarCandidatos };
