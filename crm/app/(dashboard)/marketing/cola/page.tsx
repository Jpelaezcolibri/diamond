import { createClient } from "@/lib/supabase/server";
import { getDefaultOrgId, type PublicationEventRow } from "@/lib/marketing";
import ColaList from "@/components/marketing/cola-list";

export const dynamic = "force-dynamic";

export default async function ColaPage() {
  const supabase = await createClient();
  const orgId = await getDefaultOrgId(supabase);
  if (!orgId) return <p className="text-slate-500">No hay ninguna organización configurada todavía.</p>;

  const { data } = await supabase
    .from("publication_events")
    .select("*, publications(titulo_comercial, properties(ref))")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(50);

  return <ColaList orgId={orgId} initialEvents={(data || []) as (PublicationEventRow & { publications: { titulo_comercial: string | null; properties: { ref: string } | null } | null })[]} />;
}
