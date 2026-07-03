const supabase = require("./supabase");
const memory = require("./memory");

// phoneNumberId: numero de WhatsApp (phone_number_id de Meta) por el que entro
// el mensaje actual. Se guarda/actualiza en la conversacion para que las
// respuestas (bot o asesor) salgan siempre por el mismo numero — asi conviven
// varios numeros de publicidad bajo la misma organizacion sin cruzarse.
async function findOrCreate(orgId, leadId, phoneNumberId) {
  if (!supabase) {
    let conv = memory.conversations.find((c) => c.lead_id === leadId);
    if (!conv) {
      conv = { id: memory.uid(), org_id: orgId, lead_id: leadId, estado: "activa", modo: "bot", whatsapp_phone_id: phoneNumberId || null, last_activity_at: Date.now() };
      memory.conversations.push(conv);
    } else if (phoneNumberId) {
      conv.whatsapp_phone_id = phoneNumberId;
    }
    conv.last_activity_at = Date.now();
    return conv;
  }
  const { data: existing, error: findError } = await supabase
    .from("conversations").select("*").eq("lead_id", leadId).eq("estado", "activa")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (findError) throw findError;
  if (existing) {
    const updates = { last_activity_at: new Date().toISOString() };
    if (phoneNumberId && phoneNumberId !== existing.whatsapp_phone_id) updates.whatsapp_phone_id = phoneNumberId;
    const { data: updated, error } = await supabase
      .from("conversations").update(updates).eq("id", existing.id).select().single();
    if (error) throw error;
    return updated;
  }
  const { data, error } = await supabase
    .from("conversations").insert({ org_id: orgId, lead_id: leadId, whatsapp_phone_id: phoneNumberId || null }).select().single();
  if (error) throw error;
  return data;
}

// extras: { type, media_url, media_mime, wa_message_id, reply_to_id }
async function appendMessage(conversationId, role, content, extras = {}) {
  if (!supabase) {
    const msg = { id: memory.uid(), conversation_id: conversationId, role, content, ...extras, created_at: Date.now() };
    memory.messages.push(msg);
    return msg;
  }
  const { data, error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, role, content, ...extras })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Guarda el id de Meta (wamid) de un mensaje enviado, para poder citarlo despues
async function setWaMessageId(messageId, waMessageId) {
  if (!supabase || !waMessageId) return;
  await supabase.from("messages").update({ wa_message_id: waMessageId }).eq("id", messageId);
}

// Busca un mensaje local por el wamid de Meta (para resolver respuestas citadas)
async function findByWaMessageId(waMessageId) {
  if (!supabase || !waMessageId) return null;
  const { data } = await supabase
    .from("messages").select("id").eq("wa_message_id", waMessageId).maybeSingle();
  return data;
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

module.exports = { findOrCreate, appendMessage, getRecentMessages, resetForLead, setModo, setWaMessageId, findByWaMessageId };
