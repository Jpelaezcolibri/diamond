import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { getTeamRoster } from "@/lib/team";
import { fetchSafe } from "@/lib/fetch-safe";
import type { Lead } from "@/lib/types";
import KanbanBoard from "@/components/kanban-board";
import ErrorBanner from "@/components/error-banner";

export const dynamic = "force-dynamic";

export default async function KanbanPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin = isAdmin(user);

  type ConvRow = { id: string; lead_id: string; estado: string; last_activity_at: string };
  const [leadsRes, convsRes, roster] = await Promise.all([
    fetchSafe<Lead>(supabase.from("leads").select("*").order("updated_at", { ascending: false }).limit(500), "kanban:leads"),
    fetchSafe<ConvRow>(supabase.from("conversations").select("id, lead_id, estado, last_activity_at"), "kanban:conversations"),
    getTeamRoster(),
  ]);

  const convByLead: Record<string, string> = {};
  const lastActivityByLead: Record<string, string> = {};
  convsRes.data.forEach((c) => {
    if (c.estado === "activa" && !convByLead[c.lead_id]) convByLead[c.lead_id] = c.id;
    if (!lastActivityByLead[c.lead_id] || c.last_activity_at > lastActivityByLead[c.lead_id]) {
      lastActivityByLead[c.lead_id] = c.last_activity_at;
    }
  });

  const hasError = leadsRes.hasError || convsRes.hasError;
  const message = leadsRes.message || convsRes.message;

  // KanbanBoard es "h-full" — solo se envuelve (restando espacio al tablero)
  // cuando hay un error real que mostrar; en el camino feliz queda como
  // hijo directo de <main>, igual que antes.
  const board = (
    <KanbanBoard
      initialLeads={leadsRes.data}
      convByLead={convByLead}
      lastActivityByLead={lastActivityByLead}
      admin={admin}
      roster={roster}
      currentUserId={user?.id || ""}
    />
  );

  if (!hasError) return board;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-4 pt-4">
        <ErrorBanner message={message} />
      </div>
      <div className="min-h-0 flex-1">{board}</div>
    </div>
  );
}
