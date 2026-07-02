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

module.exports = { findForTransfer };
