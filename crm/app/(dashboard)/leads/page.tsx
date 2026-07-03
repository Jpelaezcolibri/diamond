import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth";
import { type Lead } from "@/lib/types";
import LeadsTable from "@/components/leads-table";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin = isSuperAdmin(user);

  const { data } = await supabase
    .from("leads")
    .select("*")
    .order("score", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(200);

  const leads = (data || []) as Lead[];

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="mb-4 text-2xl font-bold text-slate-900">Leads</h1>
      <LeadsTable leads={leads} admin={admin} />
    </div>
  );
}
