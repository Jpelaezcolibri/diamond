import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { getTeamRoster } from "@/lib/team";
import { fetchSafe } from "@/lib/fetch-safe";
import { type Lead } from "@/lib/types";
import LeadsTable from "@/components/leads-table";
import ErrorBanner from "@/components/error-banner";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin = isAdmin(user);

  const [{ data: leads, hasError, message }, roster] = await Promise.all([
    fetchSafe<Lead>(
      supabase
        .from("leads")
        .select("*")
        .order("score", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(200),
      "leads:leads"
    ),
    getTeamRoster(),
  ]);

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <h1 className="mb-4 text-2xl font-bold text-slate-900">Leads</h1>
      {hasError && <ErrorBanner message={message} />}
      <LeadsTable leads={leads} admin={admin} roster={roster} currentUserId={user?.id || ""} />
    </div>
  );
}
