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
  if (error) {
    // Carrera: el indice unico parcial conversations_one_activa_per_lead
    // (ver migracion 2026-07-24_conversations_unique_activa) impide dos
    // conversaciones "activa" para el mismo lead — si dos mensajes casi
    // simultaneos intentan crearla, uno gana el insert y el otro choca
    // (codigo 23505). En vez de perder el mensaje, se relee la que gano.
    if (error.code === "23505") {
      const { data: retry, error: retryError } = await supabase
        .from("conversations").select("*").eq("lead_id", leadId).eq("estado", "activa")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (retryError) throw retryError;
      if (retry) return retry;
    }
    throw error;
  }
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

// Marca el estado REAL de entrega de un mensaje saliente ('sent'|'failed') —
// antes sendWhatsApp devolvia wamid|null y nadie distinguia el null de un
// envio exitoso: el CRM mostraba como enviado un mensaje de Sofi que Meta
// nunca entrego (token vencido, numero invalido, etc). Best-effort: requiere
// la migracion 2026-07-24_message_delivery; si la columna aun no existe, el
// mensaje ya quedo guardado igual, solo no se puede marcar el estado.
async function setDelivery(messageId, delivery, error) {
  if (!supabase || !messageId) return;
  try {
    const { error: dbError } = await supabase
      .from("messages")
      .update({ delivery, delivery_error: error || null })
      .eq("id", messageId);
    if (dbError) throw dbError;
  } catch (e) {
    console.warn("[conversations] No se pudo marcar delivery (revisar migracion message_delivery):", e.message);
  }
}

// Busca un mensaje local por el wamid de Meta (para resolver respuestas citadas)
async function findByWaMessageId(waMessageId) {
  if (!supabase || !waMessageId) return null;
  const { data } = await supabase
    .from("messages").select("id").eq("wa_message_id", waMessageId).maybeSingle();
  return data;
}

// Ultimos N mensajes en orden cronologico, para el historial de Claude.
// Excluye los mensajes 'system' (notas de eventos como "Transferido a..."):
// son para el historial del CRM, y la API de Anthropic solo acepta
// user/assistant dentro de `messages`.
async function getRecentMessages(conversationId, limit = 12) {
  if (!supabase) {
    return memory.messages
      .filter((m) => m.conversation_id === conversationId && m.role !== "system")
      .slice(-limit)
      .map((m) => ({ role: m.role, content: m.content }));
  }
  const { data, error } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data.reverse();
}

// Los ultimos mensajes SALIENTES con su hora, para el candado anti-duplicado
// de src/lib/mensaje-asesor.js.
//
// Existe aparte de getRecentMessages a proposito: esa alimenta el historial que
// se le manda al modelo y devuelve solo {role, content}. Sumarle created_at
// ahi le agregaria ruido a cada prompt; y sin created_at el candado no puede
// distinguir "identico hace 20 segundos" de "identico ayer", que es justo lo
// unico que necesita saber.
async function ultimosSalientes(conversationId, limit = 15) {
  if (!supabase) {
    return memory.messages
      .filter((m) => m.conversation_id === conversationId && m.role === "assistant")
      .slice(-limit)
      .map((m) => ({ role: m.role, content: m.content, created_at: m.created_at }));
  }
  const { data, error } = await supabase
    .from("messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

// Estado de entrega por wamid, para los acuses del webhook. No retrocede:
// los acuses pueden llegar desordenados (leido antes que entregado) y un
// "entregado" tardio no puede borrar un "leido". "failed" siempre pisa.
const RANGO_DELIVERY = { sent: 1, delivered: 2, read: 3, failed: 9 };
async function setDeliveryPorWamid(wamid, delivery, error) {
  if (!wamid || !RANGO_DELIVERY[delivery]) return false;
  const pisa = (actual) => delivery === "failed" || (RANGO_DELIVERY[actual] || 0) < RANGO_DELIVERY[delivery];
  if (!supabase) {
    const m = memory.messages.find((x) => x.wa_message_id === wamid);
    if (!m || !pisa(m.delivery)) return false;
    m.delivery = delivery;
    m.delivery_error = error || null;
    return true;
  }
  try {
    const { data } = await supabase.from("messages").select("id, delivery").eq("wa_message_id", wamid).maybeSingle();
    if (!data || !pisa(data.delivery)) return false;
    const { error: dbError } = await supabase
      .from("messages").update({ delivery, delivery_error: error || null }).eq("id", data.id);
    if (dbError) throw dbError;
    return true;
  } catch (e) {
    console.warn("[conversations] No se pudo guardar el acuse:", e.message);
    return false;
  }
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

// Candidatos a seguimiento automatico de Sofi (Capa B Fase 1): conversaciones
// ACTIVAS en modo bot cuyo cliente lleva entre minSilenceMin y maxSilenceMin
// sin escribir (last_activity_at solo se actualiza con mensajes ENTRANTES del
// cliente, asi que es exactamente el reloj de silencio y de la ventana de 24h).
// El filtro de estado del lead y del flag de seguimiento se hace aca; el de
// "el ultimo mensaje fue de Sofi" lo hace el worker mensaje a mensaje.
async function followupCandidates(orgId, { minSilenceMin, maxSilenceMin, estados }) {
  if (!supabase) return [];
  const now = Date.now();
  const desde = new Date(now - maxSilenceMin * 60 * 1000).toISOString();
  const hasta = new Date(now - minSilenceMin * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("conversations")
    .select("*, leads!inner(*)")
    .eq("org_id", orgId)
    .eq("estado", "activa")
    .or("modo.is.null,modo.eq.bot")
    .gte("last_activity_at", desde)
    .lte("last_activity_at", hasta)
    .in("leads.estado", estados)
    .limit(50);
  if (error) throw error;
  return (data || []).filter((c) => !c.leads?.seguimiento?.t24_sent_at);
}

// Ultimo mensaje de una conversacion (para saber quien hablo de ultimo).
async function lastMessage(conversationId) {
  if (!supabase) {
    const msgs = memory.messages.filter((m) => m.conversation_id === conversationId);
    return msgs[msgs.length - 1] || null;
  }
  const { data } = await supabase
    .from("messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

// ¿Hay algun mensaje ENTRANTE (role: "user") despues de `desdeIso`? A diferencia
// de lastMessage (que solo mira el ULTIMO mensaje de TODA la conversacion), esto
// no se deja engañar por una respuesta a un pedido MAS NUEVO: si Natalia contesta
// el match B, ese mensaje no puede silenciar el escalado del match A, mas viejo,
// que sigue pendiente (Juan, review sobre c41d1b4).
async function hayMensajeEntranteDespues(conversationId, desdeIso) {
  if (!supabase) {
    return memory.messages.some(
      (m) => m.conversation_id === conversationId && m.role === "user" && new Date(m.created_at).getTime() > new Date(desdeIso).getTime()
    );
  }
  const { data, error } = await supabase
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("role", "user")
    .gt("created_at", desdeIso)
    .limit(1);
  if (error) throw error;
  return Boolean(data && data.length);
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

module.exports = {
  findOrCreate,
  appendMessage,
  getRecentMessages,
  ultimosSalientes,
  setDeliveryPorWamid,
  resetForLead,
  setModo,
  setWaMessageId,
  setDelivery,
  findByWaMessageId,
  followupCandidates,
  lastMessage,
  hayMensajeEntranteDespues,
};
