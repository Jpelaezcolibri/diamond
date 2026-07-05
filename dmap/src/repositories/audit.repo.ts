import { getSupabase } from "./supabase.js";

export async function recordAuditLog(input: {
  org_id?: string;
  actor: string;
  action: string;
  entity_type?: string;
  entity_id?: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await getSupabase().from("dmap_audit_log").insert(input);
  if (error) throw new Error(`recordAuditLog: ${error.message}`);
}
