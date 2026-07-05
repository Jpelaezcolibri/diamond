import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente con service_role — SOLO para route handlers del servidor
 * (patron de crm/lib/supabase/admin.ts). Ignora RLS. La key NUNCA lleva
 * prefijo NEXT_PUBLIC.
 */
export function createAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}
