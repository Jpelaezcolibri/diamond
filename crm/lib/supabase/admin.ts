import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Cliente con service_role — SOLO para route handlers del servidor.
// Ignora RLS: usarlo unicamente tras validar la sesion del usuario.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
