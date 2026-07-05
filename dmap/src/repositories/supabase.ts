import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";

let client: SupabaseClient | null = null;

/** Cliente Supabase con service key — usar SOLO en repositorios, nunca exponer al API publica. */
export function getSupabase(): SupabaseClient {
  client ??= createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false }
  });
  return client;
}
