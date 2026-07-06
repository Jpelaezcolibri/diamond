import { getSupabase } from "./supabase.js";
import type { OrgMarketingSettingsRow } from "./types.js";

const DEFAULTS: Omit<OrgMarketingSettingsRow, "org_id"> = {
  auto_generate_on_new_property: true,
  auto_generate_on_photo_change: false,
  publish_window: { days: [1, 2, 3, 4, 5, 6], from: "08:00", to: "20:00" },
  timezone: "America/Bogota",
  sync_source: "wasi_public",
  sync_interval_minutes: 60,
  wasi_id_company_enc: null,
  wasi_token_enc: null,
  creative_engine: "ai"
};

export async function getOrgMarketingSettings(orgId: string): Promise<OrgMarketingSettingsRow> {
  const { data, error } = await getSupabase()
    .from("org_marketing_settings")
    .select()
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`getOrgMarketingSettings: ${error.message}`);
  return (data as OrgMarketingSettingsRow) ?? { org_id: orgId, ...DEFAULTS };
}

export async function updateOrgMarketingSettings(
  orgId: string,
  patch: Partial<Omit<OrgMarketingSettingsRow, "org_id">>
): Promise<void> {
  // Los DEFAULTS solo aplican si la fila no existe: mezclar DEFAULTS sobre
  // una fila existente borraba las credenciales de Wasi (null en DEFAULTS)
  // en cualquier guardado parcial desde el CRM — bug real (2026-07-05).
  const { data: existing, error: readError } = await getSupabase()
    .from("org_marketing_settings")
    .select()
    .eq("org_id", orgId)
    .maybeSingle();
  if (readError) throw new Error(`updateOrgMarketingSettings (read): ${readError.message}`);

  const base = (existing as OrgMarketingSettingsRow | null) ?? { org_id: orgId, ...DEFAULTS };
  const { error } = await getSupabase()
    .from("org_marketing_settings")
    .upsert({ ...base, org_id: orgId, ...patch });
  if (error) throw new Error(`updateOrgMarketingSettings: ${error.message}`);
}

export async function listOrgIdsWithMarketingEnabled(): Promise<string[]> {
  const { data, error } = await getSupabase().from("org_marketing_settings").select("org_id");
  if (error) throw new Error(`listOrgIdsWithMarketingEnabled: ${error.message}`);
  return ((data as { org_id: string }[]) ?? []).map((r) => r.org_id);
}
