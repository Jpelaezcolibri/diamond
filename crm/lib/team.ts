import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { userRole, roleLabel, userNombre, type Role } from "@/lib/auth";

export type TeamMember = { id: string; nombre: string; email: string; role: Role; roleLabel: string };

async function fetchTeamRoster(): Promise<Record<string, TeamMember>> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error || !data) return {};

  const roster: Record<string, TeamMember> = {};
  for (const u of data.users) {
    const role = userRole(u);
    roster[u.id] = { id: u.id, nombre: userNombre(u), email: u.email || "", role, roleLabel: roleLabel(role) };
  }
  return roster;
}

// Roster del equipo (id de auth.users -> nombre/rol) para mostrar el owner de
// un lead sin duplicar esos datos en la tabla leads. inbox/kanban/leads lo piden
// en cada render y el inbox lo repite en cada mensaje entrante via realtime, asi
// que se cachea 30s para no golpear el Auth Admin API de Supabase en cada uno.
export const TEAM_ROSTER_TAG = "team-roster";
export const getTeamRoster = unstable_cache(fetchTeamRoster, [TEAM_ROSTER_TAG], {
  revalidate: 30,
  tags: [TEAM_ROSTER_TAG],
});
