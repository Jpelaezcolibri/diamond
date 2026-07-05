import { createClient } from "@/lib/supabase/server";
import { getDefaultOrgId, type SocialConnectionRow } from "@/lib/marketing";
import MetaConnect from "@/components/marketing/meta-connect";

export const dynamic = "force-dynamic";

export default async function ConfiguracionPage() {
  const supabase = await createClient();
  const orgId = await getDefaultOrgId(supabase);
  if (!orgId) return <p className="text-slate-500">No hay ninguna organización configurada todavía.</p>;

  const { data } = await supabase
    .from("social_connections")
    .select("id,org_id,platform,external_account_id,external_account_name,linked_page_id,status,last_validated_at,last_error")
    .eq("org_id", orgId);

  return <MetaConnect orgId={orgId} connections={(data || []) as SocialConnectionRow[]} />;
}
