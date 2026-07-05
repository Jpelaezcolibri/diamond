import { getSupabase } from "./supabase.js";

/**
 * Acceso de DMAP a la tabla `properties`, compartida con el bot y el CRM
 * (ver db/schema.sql). DMAP solo hace upsert de los mismos campos que hoy
 * actualiza scripts/sync_wasi_public.py — nunca cambia su semantica.
 */
export interface PropertyRow {
  id: string;
  org_id: string;
  ref: string;
  titulo: string;
  tipo: string | null;
  operacion: string | null;
  precio: string | null;
  area: string | null;
  habitaciones: number | null;
  banos: number | null;
  garaje: number | null;
  estrato: number | null;
  administracion: string | null;
  zona: string | null;
  ciudad: string | null;
  descripcion: string | null;
  caracteristicas: string | null;
  link: string | null;
  disponible: boolean;
  images: string[];
  created_at: string;
}

/** Propiedades disponibles cuyo link publico apunta a info.wasi.co — insumo de wasi-public.source. */
export async function listWasiPublicProperties(orgId: string): Promise<PropertyRow[]> {
  const { data, error } = await getSupabase()
    .from("properties")
    .select()
    .eq("org_id", orgId)
    .eq("disponible", true)
    .ilike("link", "%info.wasi.co%")
    .limit(500);
  if (error) throw new Error(`listWasiPublicProperties: ${error.message}`);
  return (data as PropertyRow[]) ?? [];
}

export async function listPropertiesByOrg(orgId: string): Promise<PropertyRow[]> {
  const { data, error } = await getSupabase().from("properties").select().eq("org_id", orgId);
  if (error) throw new Error(`listPropertiesByOrg: ${error.message}`);
  return (data as PropertyRow[]) ?? [];
}

export async function getPropertyByRef(orgId: string, ref: string): Promise<PropertyRow | null> {
  const { data, error } = await getSupabase().from("properties").select().eq("org_id", orgId).eq("ref", ref).maybeSingle();
  if (error) throw new Error(`getPropertyByRef: ${error.message}`);
  return (data as PropertyRow) ?? null;
}

export async function getPropertyById(id: string): Promise<PropertyRow | null> {
  const { data, error } = await getSupabase().from("properties").select().eq("id", id).maybeSingle();
  if (error) throw new Error(`getPropertyById: ${error.message}`);
  return (data as PropertyRow) ?? null;
}

export async function updateProperty(id: string, patch: Partial<PropertyRow>): Promise<void> {
  const { error } = await getSupabase().from("properties").update(patch).eq("id", id);
  if (error) throw new Error(`updateProperty: ${error.message}`);
}

export async function createProperty(
  input: Omit<PropertyRow, "id" | "created_at">
): Promise<PropertyRow> {
  const { data, error } = await getSupabase().from("properties").insert(input).select().single();
  if (error) throw new Error(`createProperty: ${error.message}`);
  return data as PropertyRow;
}
