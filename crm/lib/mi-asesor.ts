// "Solo lo mio" (App de asesores, Fase 1 — spec
// docs/superpowers/specs/2026-10-07-app-diamond-asesores-design.md §2).
//
// Un asesor ve los leads que son suyos por cualquiera de los caminos por los
// que un lead le llega: lo tomo en el CRM (owner_id), Sofi se lo transfirio
// (transferido_advisor_id = advisors.id), o tiene una cita suya — de la
// rotacion (cita.asesor_id = advisors.id) o vieja (cita.advisor_id = su auth).
// El admin ve todo. El filtro va en la query del servidor, no en la UI.
import type { SupabaseClient, User } from "@supabase/supabase-js";

export type MiAsesor = { id: string; name: string; alias_publico: string | null } | null;

export async function miAsesor(supabase: SupabaseClient, user: User | null): Promise<MiAsesor> {
  if (!user) return null;
  const { data } = await supabase
    .from("advisors")
    .select("id, name, alias_publico")
    .eq("auth_user_id", user.id)
    .eq("activo", true)
    .limit(1)
    .maybeSingle();
  return (data as MiAsesor) || null;
}

// El `or` de PostgREST con los cuatro caminos. Sin fila de asesor, solo los
// que tomo en el CRM.
export function filtroMisLeads(userId: string, asesor: MiAsesor): string {
  const partes = [`owner_id.eq.${userId}`, `cita->>advisor_id.eq.${userId}`];
  if (asesor) partes.push(`transferido_advisor_id.eq.${asesor.id}`, `cita->>asesor_id.eq.${asesor.id}`);
  return partes.join(",");
}
