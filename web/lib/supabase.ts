import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

/**
 * Cliente Supabase anon (lectura publica del catalogo via RLS).
 * Sin cookies ni sesion: permite paginas estaticas + ISR.
 * Devuelve null si Supabase no esta configurado → la web corre en modo DEMO
 * con inventario de muestra (mismo patron que el bot).
 */
export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return client;
}
