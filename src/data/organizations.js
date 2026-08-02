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

// Todas las orgs activas — usado por los schedulers (followups, reminders):
// antes solo procesaban getDefault() (la primera org), asi que el dia que
// exista una org #2 sus seguimientos/recordatorios nunca corrian.
async function listActive() {
  if (!supabase) return memory.organizations;
  const { data, error } = await supabase.from("organizations").select("*").eq("status", "active");
  if (error) throw error;
  return data || [];
}

// ── Interruptor del motor de Radar ───────────────────────────────────────
//
// Lo que apaga es lo que se paga: clasificar un export y mandar el digest.
// Leer lo ya detectado nunca depende de esto.

async function findById(orgId) {
  if (!supabase) return memory.organizations.find((o) => o.id === orgId) || null;
  const { data, error } = await supabase
    .from("organizations").select("*").eq("id", orgId).maybeSingle();
  if (error) throw error;
  return data;
}

// La decision, sin IO. Solo un `false` explicito apaga: si la columna todavia
// no existe (migracion sin correr) o la org no se pudo leer, se asume
// ENCENDIDO. Una organizacion que nunca pidio apagar Radar no puede quedarse
// sin producto porque falte un alter table.
function radarEncendido(org) {
  return org?.radar_activo !== false;
}

async function radarActivo(orgId) {
  return radarEncendido(await findById(orgId));
}

async function setRadarActivo(orgId, activo) {
  if (!supabase) {
    const o = memory.organizations.find((x) => x.id === orgId);
    if (!o) throw new Error("Organizacion no encontrada");
    o.radar_activo = Boolean(activo);
    return o;
  }
  const { data, error } = await supabase
    .from("organizations")
    .update({ radar_activo: Boolean(activo) })
    .eq("id", orgId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

module.exports = {
  findByWhatsappPhoneId, getDefault, listActive,
  findById, radarActivo, setRadarActivo, radarEncendido,
};
