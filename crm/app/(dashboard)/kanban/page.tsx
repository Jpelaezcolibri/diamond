import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { getTeamRoster } from "@/lib/team";
import type { Lead } from "@/lib/types";
import KanbanBoard from "@/components/kanban-board";

export const dynamic = "force-dynamic";

export default async function KanbanPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin = isAdmin(user);

  const [{ data: leads }, { data: convs }, roster] = await Promise.all([
    supabase.from("leads").select("*").order("updated_at", { ascending: false }).limit(500),
    supabase.from("conversations").select("id, lead_id, estado, last_activity_at"),
    getTeamRoster(),
  ]);

  const convByLead: Record<string, string> = {};
  const lastActivityByLead: Record<string, string> = {};
  (convs || []).forEach((c) => {
    if (c.estado === "activa" && !convByLead[c.lead_id]) convByLead[c.lead_id] = c.id;
    if (!lastActivityByLead[c.lead_id] || c.last_activity_at > lastActivityByLead[c.lead_id]) {
      lastActivityByLead[c.lead_id] = c.last_activity_at;
    }
  });

  return (
    <KanbanBoard
      initialLeads={(leads || []) as Lead[]}
      convByLead={convByLead}
      lastActivityByLead={lastActivityByLead}
      admin={admin}
      roster={roster}
      currentUserId={user?.id || ""}
    />
  );
}
