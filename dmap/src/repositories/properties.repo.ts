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
  // Opcional en el tipo: la columna llega con la migracion
  // 2026-10-19_periodo_precio.sql y antes de ella no existe.
  periodo_precio?: "mensual" | "diario" | "semanal" | null;
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

/**
 * Columnas que el sync escribe pero que pueden no existir todavia en la base
 * (llegan con una migracion que corre Juan a mano). Si la base responde que
 * no la conoce, se reintenta sin ella y se avisa una sola vez: una columna
 * opcional nunca puede tumbar la corrida — un sync caido deja al radar sin
 * inventario (ver wasi-credenciales-sync-apago-inventario, 2026-10-16).
 */
const COLUMNAS_OPCIONALES = ["periodo_precio"] as const;
const columnasAusentes = new Set<string>();

export function columnaFaltanteDe(mensaje: string): string | null {
  return COLUMNAS_OPCIONALES.find((c) => mensaje.includes(`'${c}'`) || mensaje.includes(`"${c}"`) || mensaje.includes(` ${c} `)) ?? null;
}

export async function conColumnasOpcionales<T>(
  payload: Record<string, unknown>,
  escribir: (p: Record<string, unknown>) => Promise<{ data?: T | null; error: { message: string } | null }>
): Promise<{ data?: T | null; error: { message: string } | null }> {
  const limpio = { ...payload };
  for (const c of columnasAusentes) delete limpio[c];
  const r = await escribir(limpio);
  const faltante = r.error ? columnaFaltanteDe(r.error.message) : null;
  if (!faltante || !(faltante in limpio)) return r;
  columnasAusentes.add(faltante);
  console.warn(`[properties] La columna ${faltante} no existe todavia (falta su migracion); se sigue sin ella.`);
  delete limpio[faltante];
  return escribir(limpio);
}

export function _resetColumnasAusentes(): void {
  columnasAusentes.clear();
}

export async function updateProperty(id: string, patch: Partial<PropertyRow>): Promise<void> {
  const { error } = await conColumnasOpcionales(patch, async (p) => getSupabase().from("properties").update(p).eq("id", id));
  if (error) throw new Error(`updateProperty: ${error.message}`);
}

export async function createProperty(
  input: Omit<PropertyRow, "id" | "created_at">
): Promise<PropertyRow> {
  const { data, error } = await conColumnasOpcionales<PropertyRow>(input, async (p) =>
    getSupabase().from("properties").insert(p).select().single()
  );
  if (error) throw new Error(`createProperty: ${error.message}`);
  return data as PropertyRow;
}
