// Seguimiento automatico de Sofi al cliente que dejo de responder — Capa B
// Fase 1 de diamond-os/sofi-conversacion-2.0.md (disenada y aprobada; aqui la
// version minima activable): UN toque contextual dentro de la ventana de 24h
// de WhatsApp (texto libre — pasada la ventana harian falta plantillas, eso
// es Fase 2).
//
// Reglas:
// - Candidatos: leads en_conversacion|calificado, conversacion activa en modo
//   bot, silencio del cliente entre silenceMin y maxSilenceMin (tope 20h por
//   defecto: margen de seguridad antes del cierre de la ventana de 24h).
// - Solo si el ultimo mensaje fue de Sofi (el cliente callo; si el ultimo fue
//   del cliente, Sofi le debe respuesta y esto no aplica).
// - UN solo toque por lead (flag en leads.seguimiento.t24_sent_at). Si la
//   migracion 2026-07-23_lead_seguimiento no ha corrido, el worker se
//   auto-desactiva con un warn (nunca spamea por no poder marcar).
// - Horario: nada entre quietStartHour (8pm) y quietEndHour (8am) Colombia.
// - El mensaje lo redacta Claude con el historial: corto, calido, con UNA
//   pregunta concreta para retomar; queda guardado en la conversacion como
//   mensaje de Sofi (visible en el CRM).
const config = require("../config");
const organizations = require("../data/organizations");
const leads = require("../data/leads");
const conversations = require("../data/conversations");
const { sendWhatsApp } = require("../channels/whatsapp");
const { getClient } = require("../lib/anthropic");

// Backstop en memoria contra dobles envios dentro del mismo proceso (si el
// update del flag falla, el reinicio del server es el unico reintento posible).
const sentThisProcess = new Set();
let columnMissing = false;

// Hora local en Colombia (0-23) — exportada para poder testearla.
function hourInBogota(date = new Date()) {
  return parseInt(
    new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "numeric", hour12: false }).format(date),
    10
  );
}

// Horario de silencio: [quietStartHour, 24) U [0, quietEndHour). Con los
// defaults (20 y 8): nada de 8pm a 8am.
function inQuietHours(hour, { quietStartHour, quietEndHour }) {
  return hour >= quietStartHour || hour < quietEndHour;
}

// org: se interpola el nombre en vez de hardcodear "una inmobiliaria en
// Medellin" — antes el mensaje de seguimiento de CUALQUIER org se presentaba
// siempre como si fuera Diamond en Medellin.
function buildFollowupSystemPrompt(org) {
  const nombre = org?.name || "la inmobiliaria";
  return `Eres Sofi, asesora digital de ${nombre} (tono paisa suave, calido y profesional; nada de muletillas forzadas).
El cliente dejo de responder hace unas horas. Escribe UN unico mensaje corto de seguimiento para retomar la conversacion por WhatsApp.
Reglas:
- Maximo 2-3 lineas. Un solo emoji como mucho.
- Retoma el contexto real de la conversacion (propiedad, dato pendiente o siguiente paso que quedo en el aire). No repitas informacion ya dada.
- Cierra con UNA pregunta concreta y facil de responder.
- No presiones ni insistas; si el cliente ya habia dicho que no le interesa, limita el mensaje a dejarle la puerta abierta.
- Responde SOLO con el texto del mensaje, sin comillas ni explicaciones.`;
}

async function buildFollowupMessage(conversationId, org) {
  const history = await conversations.getRecentMessages(conversationId, 12);
  if (!history.length) return null;
  const response = await getClient().messages.create({
    model: config.claudeModel,
    max_tokens: 300,
    system: buildFollowupSystemPrompt(org),
    messages: [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      {
        role: "user",
        content:
          "[instruccion del sistema, el cliente NO escribio esto: el cliente lleva horas sin responder. Genera el mensaje de seguimiento segun tus reglas.]",
      },
    ],
  });
  const text = (response.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return text || null;
}

async function runOnce() {
  if (!config.followups.enabled || columnMissing) return { sent: 0 };
  const hour = hourInBogota();
  if (inQuietHours(hour, config.followups)) return { sent: 0, quiet: true };

  // Antes solo se procesaba organizations.getDefault() (la primera org): el
  // dia que exista una org #2 sus seguimientos nunca corrian. Se itera cada
  // org activa por separado (candidatos, prompt y numero de origen propios).
  const orgs = await organizations.listActive();

  let sent = 0;
  for (const org of orgs) {
    const candidates = await conversations.followupCandidates(org.id, {
      minSilenceMin: config.followups.silenceMin,
      maxSilenceMin: config.followups.maxSilenceMin,
      estados: ["en_conversacion", "calificado"],
    });

    for (const conv of candidates) {
      const lead = conv.leads;
      if (!lead || sentThisProcess.has(lead.id)) continue;
      try {
        // Blindaje de migracion: sin la columna `seguimiento` no hay forma de
        // marcar el envio → mejor no enviar nada que enviar repetido.
        if (!("seguimiento" in lead)) {
          columnMissing = true;
          console.warn("[followups] leads.seguimiento no existe — correr migracion 2026-07-23_lead_seguimiento. Worker desactivado.");
          return { sent };
        }
        // Solo si Sofi hablo de ultimo (el cliente callo).
        const last = await conversations.lastMessage(conv.id);
        if (!last || last.role !== "assistant") continue;

        const texto = await buildFollowupMessage(conv.id, org);
        if (!texto) continue;

        // Claim atomico ANTES de enviar (ver src/data/leads.js#claimFollowup):
        // el UPDATE lleva su propio WHERE ...is null, asi que si dos ticks (o
        // dos replicas, a futuro) corrieran a la vez sobre el mismo lead, solo
        // uno gana el claim — el otro se salta el lead en vez de duplicar el
        // toque. Si el envio falla despues, se pierde este toque (aceptable en
        // Fase 1: un solo intento por diseno, igual que antes).
        const claimed = await leads.claimFollowup(lead.id);
        if (!claimed) continue; // otro tick/proceso ya lo esta manejando
        sentThisProcess.add(lead.id);

        const { ok, wamid, error } = await sendWhatsApp(org, lead.phone, texto, { fromPhoneId: conv.whatsapp_phone_id });
        const msg = await conversations.appendMessage(conv.id, "assistant", texto);
        if (msg?.id) {
          await conversations.setDelivery(msg.id, ok ? "sent" : "failed", error);
          if (wamid) await conversations.setWaMessageId(msg.id, wamid);
        }
        sent++;
        console.log(`[followups] seguimiento enviado a +${lead.phone} (lead ${lead.id}, org ${org.name})`);
      } catch (e) {
        console.error("[followups] error con lead", lead?.id, e.message);
      }
    }
  }
  if (sent) console.log(`[followups] ${sent} seguimiento(s) enviado(s)`);
  return { sent };
}

function start() {
  if (!config.followups.enabled) {
    console.log("[followups] deshabilitado (FOLLOWUPS_ENABLED=false)");
    return;
  }
  const ms = config.followups.intervalMin * 60 * 1000;
  setTimeout(() => runOnce().catch((e) => console.error("[followups] runOnce:", e.message)), 45 * 1000);
  setInterval(() => runOnce().catch((e) => console.error("[followups] runOnce:", e.message)), ms);
  console.log(
    `[followups] activo — cada ${config.followups.intervalMin} min, silencio ${config.followups.silenceMin}-${config.followups.maxSilenceMin} min, quiet ${config.followups.quietStartHour}h-${config.followups.quietEndHour}h`
  );
}

module.exports = { start, runOnce, hourInBogota, inQuietHours, buildFollowupMessage, buildFollowupSystemPrompt };
