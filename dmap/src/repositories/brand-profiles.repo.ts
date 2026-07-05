import { getSupabase } from "./supabase.js";
import type { BrandProfileRow } from "./types.js";

export async function getDefaultBrandProfile(orgId: string): Promise<BrandProfileRow | null> {
  const { data, error } = await getSupabase()
    .from("brand_profiles")
    .select()
    .eq("org_id", orgId)
    .eq("is_default", true)
    .maybeSingle();
  if (error) throw new Error(`getDefaultBrandProfile: ${error.message}`);
  return (data as BrandProfileRow) ?? null;
}

export async function listBrandProfiles(orgId: string): Promise<BrandProfileRow[]> {
  const { data, error } = await getSupabase().from("brand_profiles").select().eq("org_id", orgId);
  if (error) throw new Error(`listBrandProfiles: ${error.message}`);
  return (data as BrandProfileRow[]) ?? [];
}
