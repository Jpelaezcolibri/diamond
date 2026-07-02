const Anthropic = require("@anthropic-ai/sdk");
const config = require("../config");
const leads = require("../data/leads");
const conversations = require("../data/conversations");
const properties = require("../data/properties");
const { buildSystemPrompt } = require("./prompts");
const { TOOL_DEFINITIONS, executeTool } = require("./tools");
const { isQualified } = require("./qualification");
const { buildAdvisorAlert } = require("../notifications/advisor");

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const MAX_TOOL_ITERATIONS = 5;
const HISTORY_LIMIT = 12;
const REF_PATTERN = /\b([A-Z]{2}\d{3})\b/;

// Procesa un mensaje entrante de cualquier canal.
// Devuelve { reply, lead, transfer } — transfer: { motivo, advisorAlert } si aplico.
async function procesarMensaje({ org, phone, text, source = "whatsapp" }) {
  const lead = await leads.findOrCreate(org.id, phone, source);

  // Deep link / click-to-WhatsApp: la primera mencion de una ref queda como origen
  const refMatch = text.toUpperCase().match(REF_PATTERN);
  if (refMatch && !lead.property_ref_origen) {
    Object.assign(lead, await leads.update(lead.id, {
      property_ref_origen: refMatch[1],
      estado: lead.estado === "nuevo" ? "en_conversacion" : lead.estado,
    }));
  } else if (lead.estado === "nuevo") {
    Object.assign(lead, await leads.update(lead.id, { estado: "en_conversacion" }));
  }

  const conv = await conversations.findOrCreate(org.id, lead.id);
  await conversations.appendMessage(conv.id, "user", text);

  const history = await conversations.getRecentMessages(conv.id, HISTORY_LIMIT);
  const messages = history.map((m) => ({ role: m.role, content: m.content }));

  const ctx = { org, lead, propertyInteres: null, transfer: null };
  if (lead.property_ref_origen) {
    const origen = await properties.findByRef(org.id, lead.property_ref_origen);
    if (origen?.disponible) ctx.propertyInteres = origen;
  }

  const system = buildSystemPrompt({ org, lead, qualified: isQualified(lead) });

  let response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 1024,
    system,
    messages,
    tools: TOOL_DEFINITIONS,
  });

  let iterations = 0;
  while (response.stop_reason === "tool_use" && iterations < MAX_TOOL_ITERATIONS) {
    iterations++;
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
      max_tokens: 1024,
      system,
      messages,
      tools: TOOL_DEFINITIONS,
    });
  }

  const extractText = (r) =>
    r.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();

  let reply = extractText(response);
  if (!reply && response.stop_reason !== "tool_use") {
    // Respuesta vacia transitoria: reintentar una vez antes de rendirse
    console.warn("[engine] Respuesta vacia del modelo — reintentando");
    response = await client.messages.create({
      model: config.claudeModel,
      max_tokens: 1024,
      system,
      messages,
      tools: TOOL_DEFINITIONS,
    });
    reply = extractText(response);
  }
  reply = reply || "Disculpa, no pude procesar tu mensaje. ¿Puedes intentarlo de nuevo? 🙏";

  await conversations.appendMessage(conv.id, "assistant", reply);

  let transfer = null;
  if (ctx.transfer) {
    Object.assign(lead, await leads.update(lead.id, { estado: "transferido" }));
    const advisor = ctx.transfer.advisor;
    transfer = {
      motivo: ctx.transfer.motivo,
      especialidad: ctx.transfer.especialidad,
      advisorName: advisor.name,
      advisorPhone: advisor.phone,
      advisorAlert: buildAdvisorAlert(org, lead, ctx.transfer.motivo, ctx.propertyInteres, ctx.transfer.especialidad),
    };
  }

  return { reply, lead, transfer };
}

module.exports = { procesarMensaje };
