import { getSupabase } from "../../repositories/supabase.js";
import { PROPERTY_CONTEXT_SCHEMA_VERSION, type PropertyContext } from "../domain/property-context.js";

export interface PropertyContextRow {
  id: string;
  org_id: string;
  property_id: string;
  property_ref: string;
  schema_version: number;
  prompt_version: string;
  source_hash: string;
  status: "pending" | "ready" | "stale" | "failed";
  context: PropertyContext | Record<string, never>;
  error: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertPropertyContextInput {
  org_id: string;
  property_id: string;
  property_ref: string;
  prompt_version: string;
  source_hash: string;
  status: PropertyContextRow["status"];
  context: PropertyContext | Record<string, never>;
  error?: string | null;
  model?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cost_usd?: number | null;
}

/** Una fila viva por (org, propiedad, schema_version) — el upsert la reemplaza; el historial queda en content_generations. */
export async function upsertPropertyContext(input: UpsertPropertyContextInput): Promise<PropertyContextRow> {
  const { data, error } = await getSupabase()
    .from("property_contexts")
    .upsert(
      { ...input, schema_version: PROPERTY_CONTEXT_SCHEMA_VERSION, updated_at: new Date().toISOString() },
      { onConflict: "org_id,property_id,schema_version" }
    )
    .select()
    .single();
  if (error) throw new Error(`upsertPropertyContext: ${error.message}`);
  return data as PropertyContextRow;
}

export async function getContextByPropertyId(orgId: string, propertyId: string): Promise<PropertyContextRow | null> {
  const { data, error } = await getSupabase()
    .from("property_contexts")
    .select()
    .eq("org_id", orgId)
    .eq("property_id", propertyId)
    .eq("schema_version", PROPERTY_CONTEXT_SCHEMA_VERSION)
    .maybeSingle();
  if (error) throw new Error(`getContextByPropertyId: ${error.message}`);
  return (data as PropertyContextRow) ?? null;
}

export async function getContextByRef(orgId: string, ref: string): Promise<PropertyContextRow | null> {
  const { data, error } = await getSupabase()
    .from("property_contexts")
    .select()
    .eq("org_id", orgId)
    .eq("property_ref", ref)
    .eq("schema_version", PROPERTY_CONTEXT_SCHEMA_VERSION)
    .maybeSingle();
  if (error) throw new Error(`getContextByRef: ${error.message}`);
  return (data as PropertyContextRow) ?? null;
}

/**
 * Contexto listo para consumir en generacion de contenido. Devuelve null si
 * no existe o no esta 'ready' — el consumidor cae al flujo legacy (nunca
 * bloquea la generacion esperando un contexto).
 */
export async function getReadyContext(orgId: string, propertyId: string): Promise<PropertyContext | null> {
  const row = await getContextByPropertyId(orgId, propertyId);
  if (!row || row.status !== "ready") return null;
  return row.context as PropertyContext;
}

export async function markContextStale(orgId: string, propertyId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("property_contexts")
    .update({ status: "stale", updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("property_id", propertyId)
    .eq("schema_version", PROPERTY_CONTEXT_SCHEMA_VERSION)
    .eq("status", "ready");
  if (error) throw new Error(`markContextStale: ${error.message}`);
}

/** Contextos a regenerar en el batch nocturno: stale (la propiedad cambio) y failed (reintento). */
export async function listStaleContexts(orgId: string): Promise<PropertyContextRow[]> {
  const { data, error } = await getSupabase()
    .from("property_contexts")
    .select()
    .eq("org_id", orgId)
    .eq("schema_version", PROPERTY_CONTEXT_SCHEMA_VERSION)
    .in("status", ["stale", "failed"]);
  if (error) throw new Error(`listStaleContexts: ${error.message}`);
  return (data as PropertyContextRow[]) ?? [];
}

/** property_ids de la org que YA tienen fila de contexto (para calcular faltantes en el backfill). */
export async function listContextPropertyIds(orgId: string): Promise<Set<string>> {
  const { data, error } = await getSupabase()
    .from("property_contexts")
    .select("property_id")
    .eq("org_id", orgId)
    .eq("schema_version", PROPERTY_CONTEXT_SCHEMA_VERSION);
  if (error) throw new Error(`listContextPropertyIds: ${error.message}`);
  return new Set(((data as { property_id: string }[]) ?? []).map((r) => r.property_id));
}
