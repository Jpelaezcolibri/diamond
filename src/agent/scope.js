// Resolutor de Alcance del Centro de Comando. Convierte la identidad ya
// autenticada por el CRM (uid + role de Supabase) en un alcance INMUTABLE que
// viaja dentro de cada herramienta. El modelo nunca decide el alcance: se
// resuelve aca, antes del loop de IA.
const supabase = require("./../data/supabase");
const memory = require("./../data/memory");

// Resuelve la org del usuario por su fila en advisors (auth_user_id). Fallback:
// la org por defecto (primera activa), coherente con el CRM actual que opera
// una sola organizacion.
// TODO(multi-tenant): cuando exista mas de una org, exigir siempre resolucion
// por usuario en vez del fallback a la org por defecto.
async function orgIdForUser(viewerUid) {
  if (!supabase) return memory.organizations[0]?.id || null;
  if (viewerUid) {
    const { data } = await supabase
      .from("advisors")
      .select("org_id")
      .eq("auth_user_id", viewerUid)
      .maybeSingle();
    if (data?.org_id) return data.org_id;
  }
  const { data } = await supabase
    .from("organizations")
    .select("id")
    .eq("status", "active")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  return data?.id || null;
}

// role: el rol del CRM (admin | asesor_ventas | asesor_arrendamientos | ...).
// "super_admin" se tolera por compatibilidad, igual que en crm/lib/auth.ts.
async function resolveScope({ orgId = null, viewerUid, role }) {
  const isAdmin = role === "admin" || role === "super_admin";
  const resolvedOrgId = orgId || (await orgIdForUser(viewerUid));
  return Object.freeze({
    orgId: resolvedOrgId,
    viewerUid,
    role,
    isAdmin,
  });
}

module.exports = { resolveScope };
