// Nadie espera sin que alguien se entere (spec 2026-10-21 §2.7).
//
// Del 3 al 15-oct Sofi callo 12 dias y nadie lo supo. Cada 5 min (8 a. m.-8 p. m.
// Bogota) este vigilante busca conversaciones cuyo ULTIMO mensaje es del cliente
// y lleva mas de 15 min sin respuesta (de Sofi o de la asesora; los dos salen
// como role "assistant").
//   - Modo bot: UNA alerta tecnica agregada a Juan por episodio; no se repite
//     hasta que no quede ningun cliente esperando (Sofi volvio a contestar).
//   - Modo humano: notificacion por la campana a la asesora duena, una vez por
//     mensaje (leads.seguimiento.espera_alertada_msg_id). Nunca por WhatsApp.
// Interruptor: SOFI_ALERTA_ESPERA (encendido salvo "false").

const { enviarAlertaTecnica } = require("../lib/alerta-saldo");
const { hourInBogota, inQuietHours } = require("./followups");

const MIN = 60 * 1000;
const H = 60 * MIN;
const ESPERA_MS = 15 * MIN;
const VENTANA_MS = 48 * H;
const VALORES_APAGADO = new Set(["false", "0", "no", "off"]);
// Mensajes que no esperan respuesta ("ok", "gracias", un emoji, un like).
const PALABRA_CIERRE = "(?:ok(?:ey|ay)?|listo|vale|dale|perfecto|gracias|muchas|mil|super|excelente|genial|bien|de acuerdo|entendido|recibido|chao|adios|hasta luego)";
const SEP = String.raw`[\s\p{P}\p{S}]*`;
const NO_ESPERA = new RegExp(`^${SEP}(?:${PALABRA_CIERRE}${SEP})*$`, "iu");

let alertadoBot = new Map(); // orgId -> true mientras dura el episodio

function activo() {
  return !VALORES_APAGADO.has(String(process.env.SOFI_ALERTA_ESPERA ?? "").trim().toLowerCase());
}

function esperaRespuesta(texto) {
  const t = String(texto || "").trim();
  if (!t) return false;
  if (/^\[(imagen|nota de voz|video|documento) recibid/i.test(t)) return true;
  return !NO_ESPERA.test(t);
}

/** Pura: ¿este candidato es un cliente esperando? */
function estaEsperando({ lead, ultimo }, ahora = new Date()) {
  if (!lead || lead.source === "asesor") return false;
  if (!ultimo || ultimo.role !== "user") return false;
  if (ahora.getTime() - new Date(ultimo.created_at).getTime() < ESPERA_MS) return false;
  return esperaRespuesta(ultimo.content);
}

function depsPorDefecto() {
  return {
    orgs: () => require("../data/organizations").listActive(),
    candidatos: (org, ahora) => cargarCandidatos(org, ahora),
    alertar: (resumen, detalle) => enviarAlertaTecnica(resumen, detalle),
    asesorDuenio: async (org, lead) => {
      const advisors = require("../data/advisors");
      if (lead.transferido_advisor_id) {
        const a = await advisors.findById(org.id, lead.transferido_advisor_id);
        if (a) return a;
      }
      return lead.owner_id ? advisors.findByAuthUserId(org.id, lead.owner_id) : null;
    },
    notificar: (args) => require("../notifications/notificar").notificar(args),
    marcar: async (lead, msgId) => {
      const leads = require("../data/leads");
      await leads.update(lead.id, { seguimiento: { ...(lead.seguimiento || {}), espera_alertada_msg_id: msgId } });
    },
  };
}

async function cargarCandidatos(org, ahora) {
  const supabase = require("../data/supabase");
  if (!supabase) return [];
  const desde = new Date(ahora.getTime() - VENTANA_MS).toISOString();
  const { data: convs, error } = await supabase
    .from("conversations")
    .select("id, modo, leads!inner(*)")
    .eq("org_id", org.id)
    .eq("estado", "activa")
    .gte("last_activity_at", desde)
    .limit(300);
  if (error) throw error;
  if (!convs || !convs.length) return [];
  const { data: msgs, error: e2 } = await supabase
    .from("messages")
    .select("id, conversation_id, role, content, created_at")
    .in("conversation_id", convs.map((c) => c.id))
    .in("role", ["user", "assistant"])
    .gte("created_at", desde)
    .order("created_at", { ascending: false })
    .limit(3000);
  if (e2) throw e2;
  const ultimoDe = new Map();
  for (const m of msgs || []) if (!ultimoDe.has(m.conversation_id)) ultimoDe.set(m.conversation_id, m);
  return convs.map((c) => ({ id: c.id, modo: c.modo, lead: c.leads, ultimo: ultimoDe.get(c.id) || null }));
}

async function runOnce({ ahora = new Date(), deps = null } = {}) {
  if (!activo()) return { bot: 0, humano: 0 };
  if (inQuietHours(hourInBogota(ahora), { quietStartHour: 20, quietEndHour: 8 })) return { bot: 0, humano: 0, quiet: true };
  const d = deps || depsPorDefecto();
  const out = { bot: 0, humano: 0 };
  for (const org of await d.orgs()) {
    let candidatos;
    try {
      candidatos = await d.candidatos(org, ahora);
    } catch (e) {
      console.error(`[lead-esperando] ${org.name}: no se pudo consultar:`, e.message);
      continue; // sin datos no se alerta ni se da por resuelto el episodio
    }
    const esperando = (candidatos || []).filter((c) => estaEsperando(c, ahora));
    const enBot = esperando.filter((c) => c.modo !== "humano");
    out.bot += enBot.length;
    if (!enBot.length) alertadoBot.delete(org.id);
    else if (!alertadoBot.has(org.id)) {
      const salio = await Promise.resolve(
        d.alertar(`Sofi no ha contestado a ${enBot.length} cliente${enBot.length === 1 ? "" : "s"} en 15 min`, enBot.slice(0, 5).map((c) => `+${c.lead.phone}`).join(", "))
      ).catch(() => false);
      if (salio) alertadoBot.set(org.id, true);
    }
    for (const c of esperando.filter((x) => x.modo === "humano")) {
      if ((c.lead.seguimiento || {}).espera_alertada_msg_id === c.ultimo.id) continue;
      try {
        const asesor = await d.asesorDuenio(org, c.lead);
        if (!asesor) continue;
        const r = await d.notificar({
          orgId: org.id, advisor: asesor, tipo: "cliente_esperando",
          titulo: `${c.lead.nombre || `+${c.lead.phone}`} lleva 15 min esperando respuesta`,
          cuerpo: String(c.ultimo.content || "").slice(0, 140), link: `/inbox/${c.id}`, leadId: c.lead.id,
        });
        if (r && r.ok === false) continue; // se reintenta la proxima vuelta
        await d.marcar(c.lead, c.ultimo.id);
        out.humano++;
      } catch (e) {
        console.warn("[lead-esperando] aviso a la asesora fallo:", e.message);
      }
    }
  }
  return out;
}

function start() {
  if (!activo()) return console.log("[lead-esperando] apagado (SOFI_ALERTA_ESPERA=false)");
  const tick = () => runOnce().catch((e) => console.error("[lead-esperando] runOnce:", e.message));
  setTimeout(tick, 2 * MIN);
  setInterval(tick, 5 * MIN);
  console.log("[lead-esperando] activo — avisa si un cliente espera 15 min sin respuesta");
}

function _reset() {
  alertadoBot = new Map();
}

module.exports = { start, runOnce, estaEsperando, esperaRespuesta, _reset };
