const supabase = require("./supabase");
const memory = require("./memory");

async function findByWhatsappPhoneId(phoneId) {
  if (!supabase) {
    return memory.organizations.find((o) => o.whatsapp_phone_id === phoneId) || null;
  }
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("whatsapp_phone_id", phoneId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Org por defecto para canales de prueba (Telegram, /test) en fase single-tenant
async function getDefault() {
  if (!supabase) return memory.organizations[0];
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("status", "active")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

module.exports = { findByWhatsappPhoneId, getDefault };
