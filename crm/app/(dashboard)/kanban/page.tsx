import { createClient } from "@/lib/supabase/server";
import type { Lead } from "@/lib/types";
import KanbanBoard from "@/components/kanban-board";

export const dynamic = "force-dynamic";

export default async function KanbanPage() {
  const supabase = await createClient();

  const [{ data: leads }, { data: convs }] = await Promise.all([
    supabase.from("leads").select("*").order("updated_at", { ascending: false }).limit(500),
    supabase.from("conversations").select("id, lead_id").eq("estado", "activa"),
  ]);

  const convByLead: Record<string, string> = {};
  (convs || []).forEach((c) => {
    if (!convByLead[c.lead_id]) convByLead[c.lead_id] = c.id;
  });

  return <KanbanBoard initialLeads={(leads || []) as Lead[]} convByLead={convByLead} />;
}
