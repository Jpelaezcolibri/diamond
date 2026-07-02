const supabase = require("./supabase");
const memory = require("./memory");

async function findOrCreate(orgId, leadId) {
  if (!supabase) {
    let conv = memory.conversations.find((c) => c.lead_id === leadId);
    if (!conv) {
      conv = { id: memory.uid(), org_id: orgId, lead_id: leadId, estado: "activa", modo: "bot", last_activity_at: Date.now() };
      memory.conversations.push(conv);
    }
    conv.last_activity_at = Date.now();
    return conv;
  }
  const { data: existing, error: findError } = await supabase
    .from("conversations").select("*").eq("lead_id", leadId).eq("estado", "activa")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (findError) throw findError;
  if (existing) {
    await supabase.from("conversations")
      .update({ last_activity_at: new Date().toISOString() }).eq("id", existing.id);
    return existing;
  }
  const { data, error } = await supabase
    .from("conversations").insert({ org_id: orgId, lead_id: leadId }).select().single();
  if (error) throw error;
  return data;
}

async function appendMessage(conversationId, role, content) {
  if (!supabase) {
    memory.messages.push({ id: memory.uid(), conversation_id: conversationId, role, content, created_at: Date.now() });
    return;
  }
  const { error } = await supabase
    .from("messages").insert({ conversation_id: conversationId, role, content });
  if (error) throw error;
}

// Ultimos N mensajes en orden cronologico, para el historial de Claude
async function getRecentMessages(conversationId, limit = 12) {
  if (!supabase) {
    return memory.messages
      .filter((m) => m.conversation_id === conversationId)
      .slice(-limit)
      .map((m) => ({ role: m.role, content: m.content }));
  }
  const { data, error } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data.reverse();
}

async function resetForLead(leadId) {
  if (!supabase) {
    const conv = memory.conversations.find((c) => c.lead_id === leadId);
    if (conv) {
      memory.messages = memory.messages.filter((m) => m.conversation_id !== conv.id);
      memory.conversations = memory.conversations.filter((c) => c.id !== conv.id);
    }
    return;
  }
  const { error } = await supabase
    .from("conversations").update({ estado: "cerrada" }).eq("lead_id", leadId);
  if (error) throw error;
}

// Cambia el modo de atencion de una conversacion: 'bot' (Sofi) | 'humano' (asesor via CRM)
async function setModo(conversationId, modo) {
  if (!supabase) {
    const conv = memory.conversations.find((c) => c.id === conversationId);
    if (conv) conv.modo = modo;
    return conv;
  }
  const { data, error } = await supabase
    .from("conversations").update({ modo }).eq("id", conversationId).select().single();
  if (error) throw error;
  return data;
}

module.exports = { findOrCreate, appendMessage, getRecentMessages, resetForLead, setModo };
