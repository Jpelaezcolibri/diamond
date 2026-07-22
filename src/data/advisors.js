const supabase = require("./supabase");
const memory = require("./memory");

// Busca el asesor activo de la org para una especialidad (venta, arriendo,
// vehiculos, otro). Fallback: cualquier asesor activo de la org, y si no hay
// tabla de asesores poblada, el asesor por defecto de la organizacion.
async function findForTransfer(org, especialidad) {
  const esp = (especialidad || "").toLowerCase();
  let list;
  if (!supabase) {
    list = memory.advisors.filter((a) => a.org_id === org.id && a.activo);
  } else {
    const { data, error } = await supabase
      .from("advisors")
      .select("*")
      .eq("org_id", org.id)
      .eq("activo", true);
    if (error) throw error;
    list = data || [];
  }
  const match = list.find((a) => a.especialidad === esp) || list[0];
  if (match) return match;
  // Fallback single-advisor: el asesor definido en la organizacion
  return org.advisor_phone
    ? { name: org.advisor_name || "Asesor", phone: org.advisor_phone, especialidad: "general" }
    : null;
}

// Busca el asesor (fila de advisors) vinculado a un login del CRM
// (auth_user_id) — usado para dirigir el aviso de un match de aliado a quien
// registro esa propiedad, no al asesor de la especialidad.
async function findByAuthUserId(orgId, authUserId) {
  if (!authUserId) return null;
  if (!supabase) {
    return memory.advisors.find((a) => a.org_id === orgId && a.auth_user_id === authUserId) || null;
  }
  const { data, error } = await supabase
    .from("advisors")
    .select("*")
    .eq("org_id", orgId)
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

module.exports = { findForTransfer, findByAuthUserId };
