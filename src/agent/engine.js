const Anthropic = require("@anthropic-ai/sdk");
const config = require("../config");
const leads = require("../data/leads");
const conversations = require("../data/conversations");
const properties = require("../data/properties");
const { buildSystemPrompt } = require("./prompts");
const { TOOL_DEFINITIONS, executeTool } = require("./tools");
const { isQualified } = require("./qualification");
const { buildAdvisorAlert, formatCitaFechaHora } = require("../notifications/advisor");
const { detectSellerIntent } = require("./intent");

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const MAX_TOOL_ITERATIONS = 5;
const HISTORY_LIMIT = 12;

// Fecha y hora actual en Colombia, legible + ISO, para que Sofi resuelva
// referencias relativas ("manana a las 8") a una fecha concreta al agendar.
function nowInBogota() {
  const tz = "America/Bogota";
  const d = new Date();
  const legible = d.toLocaleString("es-CO", {
    timeZone: tz,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  // Offset fijo de Colombia (-05:00, sin horario de verano) para el ISO.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const iso = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}-05:00`;
  return { legible, iso };
}
// Referencias: codigo Wasi de 6-8 digitos (ej 9702941) o formato legacy AA000
const REF_PATTERN = /\b([A-Z]{2}\d{3}|\d{6,8})\b/;

// Procesa un mensaje entrante de cualquier canal.
// adReferral: objeto "referral" que WhatsApp Cloud API adjunta al PRIMER
// mensaje cuando la conversacion se origino en un anuncio de clic-a-WhatsApp
// (Click-to-WhatsApp Ads) — permite separar en el CRM los leads que llegaron
// por un anuncio pago de los organicos, sin tocar `source` (canal).
// Devuelve { reply, lead, transfer } — transfer: { motivo, advisorAlert } si aplico.
async function procesarMensaje({ org, phone, text, source = "whatsapp", messageExtras = {}, phoneNumberId = null, adReferral = null }) {
  const lead = await leads.findOrCreate(org.id, phone, source);

  // Deep link / click-to-WhatsApp: la primera mencion de una ref queda como origen
  const refMatch = text.toUpperCase().match(REF_PATTERN);
  if (refMatch && !lead.property_ref_origen) {
    Object.assign(lead, await leads.update(lead.id, { property_ref_origen: refMatch[1] }));
  }
  // Igual que arriba: solo se guarda del PRIMER mensaje que lo trae (el
  // origen del lead no cambia si mas adelante escribe mencionando otro anuncio).
  if (adReferral && !lead.ad_referral) {
    Object.assign(lead, await leads.update(lead.id, { ad_referral: adReferral }));
  }
  // Un lead recien creado entra al kanban en "nuevo"; pasa a "en_conversacion"
  // cuando vuelve a escribir (segunda interaccion en adelante)
  if (!lead._isNew && lead.estado === "nuevo") {
    Object.assign(lead, await leads.update(lead.id, { estado: "en_conversacion" }));
  }

  const conv = await conversations.findOrCreate(org.id, lead.id, phoneNumberId);
  await conversations.appendMessage(conv.id, "user", text, messageExtras);

  // Conversacion tomada por un asesor desde el CRM: guardar el mensaje y callar a Sofi
  if (conv.modo === "humano") {
    return { reply: null, lead, transfer: null, assistantMessageId: null };
  }

  const history = await conversations.getRecentMessages(conv.id, HISTORY_LIMIT);
  const messages = history.map((m) => ({ role: m.role, content: m.content }));

  // Intencion de VENTA detectada de forma deterministica sobre TODO el historial
  // reciente del cliente (no solo el mensaje actual): la declaracion "quiero
  // vender" puede venir en un turno anterior y la transferencia en otro. Al
  // re-derivarla del historial, el encuadre correcto (link + alerta al asesor)
  // se mantiene aunque la columna `intencion` aun no exista para persistirla.
  // Piso de confiabilidad: no depende de que el modelo registre la intencion.
  if (lead.intencion !== "vender") {
    const clienteDijoVender = history.some((m) => m.role === "user" && detectSellerIntent(m.content));
    if (clienteDijoVender) {
      lead.intencion = "vender";
      try {
        Object.assign(lead, await leads.update(lead.id, { intencion: "vender" }));
      } catch {
        // Columna aun no existe (migracion pendiente): queda en memoria, suficiente
        // para este turno; se re-detecta del historial en los siguientes.
      }
    }
  }

  const ctx = { org, lead, propertyInteres: null, transfer: null, cita: null, allyMatch: null, allyAlert: null, appointmentAlert: null, lastUserMessage: text };
  if (lead.property_ref_origen) {
    const origen = await properties.findByRef(org.id, lead.property_ref_origen);
    if (origen?.disponible) ctx.propertyInteres = origen;
    // La propiedad de origen define el tablero del lead (compra/alquiler)
    if (origen && (!lead.categoria || lead.categoria === "otros")) {
      const categoria = (origen.operacion || "").toLowerCase() === "arriendo" ? "alquiler" : "compra";
      Object.assign(lead, await leads.update(lead.id, { categoria }));
    }
  }

  const system = buildSystemPrompt({ org, lead, qualified: isQualified(lead), now: nowInBogota() });

  const extractText = (r) =>
    r.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();

  let response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 2048,
    system,
    messages,
    tools: TOOL_DEFINITIONS,
  });

  // Claude puede escribir texto conversacional EN EL MISMO turno en que llama
  // una tool (ej. agradecer a un aliado no depende del resultado de guardarlo)
  // — ese texto se acumula aqui por cada turno, en vez de leerse solo de la
  // ultima respuesta del loop, para no perderlo (bug real 2026-07-06: Sofi
  // quedaba en blanco al reconocer una propiedad de aliado).
  const textParts = [];
  let iterations = 0;
  while (response.stop_reason === "tool_use" && iterations < MAX_TOOL_ITERATIONS) {
    iterations++;
    const text = extractText(response);
    if (text) textParts.push(text);

    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
    messages.push({ role: "assistant", content: response.content });

    const toolResults = [];
    for (const block of toolUseBlocks) {
      let result;
      try {
        result = await executeTool(block.name, block.input, ctx);
      } catch (e) {
        console.error(`[engine] Error en tool ${block.name}:`, e.message);
        result = `Error ejecutando la herramienta: ${e.message}`;
      }
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
    }
    messages.push({ role: "user", content: toolResults });

    response = await client.messages.create({
      model: config.claudeModel,
      max_tokens: 2048,
      system,
      messages,
      tools: TOOL_DEFINITIONS,
    });
  }

  const finalText = extractText(response);
  if (finalText) textParts.push(finalText);
  let reply = textParts.join("\n").trim();

  if (!reply && response.stop_reason !== "tool_use") {
    // Respuesta vacia transitoria (sin texto en ningun turno): reintentar una
    // vez antes de rendirse.
    console.warn("[engine] Respuesta vacia del modelo — reintentando");
    response = await client.messages.create({
      model: config.claudeModel,
      max_tokens: 2048,
      system,
      messages,
      tools: TOOL_DEFINITIONS,
    });
    reply = extractText(response);
  }
  reply = reply || "Disculpa, no pude procesar tu mensaje. ¿Puedes intentarlo de nuevo? 🙏";

  const assistantMsg = await conversations.appendMessage(conv.id, "assistant", reply);

  let transfer = null;
  if (ctx.transfer) {
    Object.assign(lead, await leads.update(lead.id, { estado: "transferido" }));
    const advisor = ctx.transfer.advisor;
    const transferidoAt = new Date().toISOString();
    // Registro de a quien y cuando se transfirio. Best-effort: si las columnas
    // aun no existen (migracion 2026-07-23_lead_transferencia pendiente), la
    // transferencia sigue funcionando igual que antes.
    try {
      Object.assign(
        lead,
        await leads.update(lead.id, {
          transferido_advisor_id: advisor.id || null,
          transferido_a_nombre: advisor.name,
          transferido_at: transferidoAt,
        })
      );
    } catch (e) {
      console.warn("[engine] No se pudo persistir la transferencia (revisar migracion lead_transferencia):", e.message);
    }
    // Nota de sistema en el historial de la conversacion — queda guardada en
    // Sofi y visible en el CRM. Best-effort: requiere el role 'system' de la
    // misma migracion.
    try {
      const en = formatCitaFechaHora(transferidoAt);
      const nota = en
        ? `Transferido a ${advisor.name} — ${en.fecha}, ${en.hora}`
        : `Transferido a ${advisor.name}`;
      await conversations.appendMessage(conv.id, "system", nota);
    } catch (e) {
      console.warn("[engine] No se pudo guardar la nota de transferencia (revisar migracion lead_transferencia):", e.message);
    }
    transfer = {
      motivo: ctx.transfer.motivo,
      especialidad: ctx.transfer.especialidad,
      advisorName: advisor.name,
      advisorPhone: advisor.phone,
      advisorAlert: buildAdvisorAlert(org, lead, ctx.transfer.motivo, ctx.propertyInteres, ctx.transfer.especialidad, ctx.cita, ctx.allyMatch),
    };
  }

  // Aviso inmediato al asesor dueno de una propiedad de colega que hizo match
  // con este cliente — independiente de transfer: no espera a que el lead
  // se transfiera o califique (ver ctx.allyAlert en tools.js).
  const allyAlert = ctx.allyAlert || null;

  // Aviso inmediato al asesor cuando se le confirma una cita con dia/hora
  // validados contra su agenda — independiente de transfer (ver agendar_cita).
  const appointmentAlert = ctx.appointmentAlert || null;

  return { reply, lead, transfer, allyAlert, appointmentAlert, assistantMessageId: assistantMsg?.id || null };
}

module.exports = { procesarMensaje };
