import { getSupabase } from "./supabase.js";
import type { PublicationEventRow } from "./types.js";

export interface RecordEventInput {
  publication_id: string;
  org_id: string;
  from_status: string | null;
  to_status: string;
  actor: string;
  detail?: Record<string, unknown>;
}

export async function recordPublicationEvent(input: RecordEventInput): Promise<void> {
  const { error } = await getSupabase().from("publication_events").insert(input);
  if (error) throw new Error(`recordPublicationEvent: ${error.message}`);
}

export async function listEventsByPublication(publicationId: string): Promise<PublicationEventRow[]> {
  const { data, error } = await getSupabase()
    .from("publication_events")
    .select()
    .eq("publication_id", publicationId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listEventsByPublication: ${error.message}`);
  return (data as PublicationEventRow[]) ?? [];
}
