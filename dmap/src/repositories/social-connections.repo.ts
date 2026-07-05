import { getSupabase } from "./supabase.js";
import type { SocialConnectionRow, ConnectionStatus, SocialPlatform } from "./types.js";

export interface UpsertConnectionInput {
  org_id: string;
  platform: SocialPlatform;
  external_account_id: string;
  external_account_name?: string;
  linked_page_id?: string;
  access_token_enc: string;
  token_expires_at?: string | null;
  scopes?: string[];
  connected_by?: string;
}

export async function upsertSocialConnection(input: UpsertConnectionInput): Promise<SocialConnectionRow> {
  const { data, error } = await getSupabase()
    .from("social_connections")
    .upsert(
      { ...input, status: "connected", last_validated_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "org_id,platform,external_account_id" }
    )
    .select()
    .single();
  if (error) throw new Error(`upsertSocialConnection: ${error.message}`);
  return data as SocialConnectionRow;
}

export async function listConnectionsByOrg(orgId: string): Promise<SocialConnectionRow[]> {
  const { data, error } = await getSupabase().from("social_connections").select().eq("org_id", orgId);
  if (error) throw new Error(`listConnectionsByOrg: ${error.message}`);
  return (data as SocialConnectionRow[]) ?? [];
}

export async function getConnectionById(id: string): Promise<SocialConnectionRow | null> {
  const { data, error } = await getSupabase().from("social_connections").select().eq("id", id).maybeSingle();
  if (error) throw new Error(`getConnectionById: ${error.message}`);
  return (data as SocialConnectionRow) ?? null;
}

export async function setConnectionStatus(id: string, status: ConnectionStatus, lastError?: string): Promise<void> {
  const { error } = await getSupabase()
    .from("social_connections")
    .update({ status, last_error: lastError ?? null, last_validated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`setConnectionStatus: ${error.message}`);
}

export async function deleteConnection(id: string): Promise<void> {
  const { error } = await getSupabase().from("social_connections").delete().eq("id", id);
  if (error) throw new Error(`deleteConnection: ${error.message}`);
}

export async function upsertMetaUserToken(orgId: string, fbUserId: string, tokenEnc: string, expiresAt: string): Promise<void> {
  const { error } = await getSupabase()
    .from("meta_user_tokens")
    .upsert({ org_id: orgId, fb_user_id: fbUserId, token_enc: tokenEnc, expires_at: expiresAt, updated_at: new Date().toISOString() });
  if (error) throw new Error(`upsertMetaUserToken: ${error.message}`);
}

export async function getMetaUserToken(orgId: string): Promise<{ token_enc: string; expires_at: string | null } | null> {
  const { data, error } = await getSupabase()
    .from("meta_user_tokens")
    .select("token_enc, expires_at")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`getMetaUserToken: ${error.message}`);
  return data ?? null;
}
