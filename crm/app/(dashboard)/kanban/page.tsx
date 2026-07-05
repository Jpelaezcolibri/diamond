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
    supabase.from("conversations").select("id, lead_id").eq("estado", "activa"),
    getTeamRoster(),
  ]);

  const convByLead: Record<string, string> = {};
  (convs || []).forEach((c) => {
    if (!convByLead[c.lead_id]) convByLead[c.lead_id] = c.id;
  });

  return (
    <KanbanBoard
      initialLeads={(leads || []) as Lead[]}
      convByLead={convByLead}
      admin={admin}
      roster={roster}
      currentUserId={user?.id || ""}
    />
  );
}
