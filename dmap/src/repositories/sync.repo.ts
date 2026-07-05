import { getSupabase } from "./supabase.js";
import type {
  SyncRunRow,
  PropertySyncStateRow,
  PropertyChangeEventRow,
  SyncSource,
  PropertyChangeType
} from "./types.js";

export async function startSyncRun(orgId: string, source: SyncSource): Promise<SyncRunRow> {
  const { data, error } = await getSupabase()
    .from("sync_runs")
    .insert({ org_id: orgId, source, status: "running" })
    .select()
    .single();
  if (error) throw new Error(`startSyncRun: ${error.message}`);
  return data as SyncRunRow;
}

export async function finishSyncRun(
  id: string,
  status: "success" | "failed",
  stats: SyncRunRow["stats"],
  error?: string
): Promise<void> {
  const { error: dbError } = await getSupabase()
    .from("sync_runs")
    .update({ status, stats, error: error ?? null, finished_at: new Date().toISOString() })
    .eq("id", id);
  if (dbError) throw new Error(`finishSyncRun: ${dbError.message}`);
}

export async function getPropertySyncState(propertyId: string): Promise<PropertySyncStateRow | null> {
  const { data, error } = await getSupabase()
    .from("property_sync_state")
    .select()
    .eq("property_id", propertyId)
    .maybeSingle();
  if (error) throw new Error(`getPropertySyncState: ${error.message}`);
  return (data as PropertySyncStateRow) ?? null;
}

export async function listSyncStateByOrg(orgId: string): Promise<PropertySyncStateRow[]> {
  const { data, error } = await getSupabase().from("property_sync_state").select().eq("org_id", orgId);
  if (error) throw new Error(`listSyncStateByOrg: ${error.message}`);
  return (data as PropertySyncStateRow[]) ?? [];
}

export async function upsertPropertySyncState(state: Omit<PropertySyncStateRow, "last_seen_at">): Promise<void> {
  const { error } = await getSupabase()
    .from("property_sync_state")
    .upsert({ ...state, last_seen_at: new Date().toISOString() });
  if (error) throw new Error(`upsertPropertySyncState: ${error.message}`);
}

export async function recordPropertyChangeEvent(input: {
  org_id: string;
  property_id: string | null;
  sync_run_id: string;
  change_type: PropertyChangeType;
  old_value?: unknown;
  new_value?: unknown;
}): Promise<void> {
  const { error } = await getSupabase().from("property_change_events").insert(input);
  if (error) throw new Error(`recordPropertyChangeEvent: ${error.message}`);
}

export async function listUnprocessedChangeEvents(orgId: string): Promise<PropertyChangeEventRow[]> {
  const { data, error } = await getSupabase()
    .from("property_change_events")
    .select()
    .eq("org_id", orgId)
    .eq("processed", false)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listUnprocessedChangeEvents: ${error.message}`);
  return (data as PropertyChangeEventRow[]) ?? [];
}

export async function markChangeEventProcessed(id: number): Promise<void> {
  const { error } = await getSupabase().from("property_change_events").update({ processed: true }).eq("id", id);
  if (error) throw new Error(`markChangeEventProcessed: ${error.message}`);
}

/**
 * Resuelve las novedades pendientes de una propiedad (creada/precio/fotos/
 * descripcion cambiados) cuando se genera una publicacion para ella — sin
 * esto "Novedades del inventario" en el CRM nunca se vacia, incluso despues
 * de generar contenido (bug real 2026-07-05: 100 novedades acumuladas,
 * dashboard truncando a 20 sin avisar). No toca eventos `removed`: esos son
 * informativos (propiedad vendida/retirada) y no se resuelven generando
 * una publicacion nueva.
 */
export async function markChangeEventsProcessedForProperty(orgId: string, propertyId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("property_change_events")
    .update({ processed: true })
    .eq("org_id", orgId)
    .eq("property_id", propertyId)
    .eq("processed", false)
    .neq("change_type", "removed");
  if (error) throw new Error(`markChangeEventsProcessedForProperty: ${error.message}`);
}
