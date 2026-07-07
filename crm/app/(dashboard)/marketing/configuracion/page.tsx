import { createClient } from "@/lib/supabase/server";
import { getDefaultOrgId, type SocialConnectionRow } from "@/lib/marketing";
import { dmapJson } from "@/lib/dmap";
import MetaConnect from "@/components/marketing/meta-connect";
import WasiSettings from "@/components/marketing/wasi-settings";
import CreativeEngineSettings from "@/components/marketing/creative-engine-settings";

export const dynamic = "force-dynamic";

interface SettingsResponse {
  sync_source: "wasi_api" | "wasi_public";
  sync_interval_minutes: number;
  hasWasiCredentials: boolean;
  creative_engine?: "ai" | "template" | "designer" | "hybrid";
}

export default async function ConfiguracionPage() {
  const supabase = await createClient();
  const orgId = await getDefaultOrgId(supabase);
  if (!orgId) return <p className="text-slate-500">No hay ninguna organización configurada todavía.</p>;

  const [{ data: connections }, settingsResult] = await Promise.all([
    supabase
      .from("social_connections")
      .select("id,org_id,platform,external_account_id,external_account_name,linked_page_id,status,last_validated_at,last_error")
      .eq("org_id", orgId),
    dmapJson<SettingsResponse>(`/api/v1/settings?orgId=${orgId}`),
  ]);

  const settings = settingsResult.ok ? (settingsResult.data as SettingsResponse) : null;

  return (
    <div className="space-y-6">
      <MetaConnect orgId={orgId} connections={(connections || []) as SocialConnectionRow[]} />
      <CreativeEngineSettings orgId={orgId} engine={settings?.creative_engine ?? "ai"} />
      <WasiSettings orgId={orgId} settings={settings} />
    </div>
  );
}
