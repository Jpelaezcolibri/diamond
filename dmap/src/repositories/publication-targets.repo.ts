import { getSupabase } from "./supabase.js";
import type { PublicationTargetRow } from "./types.js";
import type { PublicationTargetStatus } from "../domain/publication-status.js";

export async function createPublicationTargets(
  publicationId: string,
  connectionIds: string[],
  platformByConnection: Record<string, string>
): Promise<PublicationTargetRow[]> {
  const rows = connectionIds.map((connectionId) => ({
    publication_id: publicationId,
    social_connection_id: connectionId,
    platform: platformByConnection[connectionId],
    status: "pending" as const
  }));
  const { data, error } = await getSupabase().from("publication_targets").insert(rows).select();
  if (error) throw new Error(`createPublicationTargets: ${error.message}`);
  return (data as PublicationTargetRow[]) ?? [];
}

export async function listTargetsByPublication(publicationId: string): Promise<PublicationTargetRow[]> {
  const { data, error } = await getSupabase().from("publication_targets").select().eq("publication_id", publicationId);
  if (error) throw new Error(`listTargetsByPublication: ${error.message}`);
  return (data as PublicationTargetRow[]) ?? [];
}

/**
 * Claim atomico: solo una fila cambia a 'publishing' aunque dos workers
 * intenten tomar el mismo target a la vez (ver ARCHITECTURE.md #7 / #10).
 */
export async function claimTargetForPublishing(targetId: string): Promise<PublicationTargetRow | null> {
  const { data, error } = await getSupabase()
    .from("publication_targets")
    .update({ status: "publishing" })
    .eq("id", targetId)
    .in("status", ["pending", "failed"])
    .select()
    .maybeSingle();
  if (error) throw new Error(`claimTargetForPublishing: ${error.message}`);
  return (data as PublicationTargetRow) ?? null;
}

export async function markTargetPublished(
  targetId: string,
  externalPostId: string,
  permalink: string | null
): Promise<void> {
  const { error } = await getSupabase()
    .from("publication_targets")
    .update({
      status: "published",
      external_post_id: externalPostId,
      permalink,
      published_at: new Date().toISOString()
    })
    .eq("id", targetId);
  if (error) throw new Error(`markTargetPublished: ${error.message}`);
}

export async function markTargetFailed(targetId: string, errorMessage: string): Promise<void> {
  const { data: current, error: readError } = await getSupabase()
    .from("publication_targets")
    .select("attempts")
    .eq("id", targetId)
    .single();
  if (readError) throw new Error(`markTargetFailed (read): ${readError.message}`);
  const attempts = ((current as { attempts: number }).attempts ?? 0) + 1;
  const { error } = await getSupabase()
    .from("publication_targets")
    .update({ status: "failed", last_error: errorMessage, attempts })
    .eq("id", targetId);
  if (error) throw new Error(`markTargetFailed: ${error.message}`);
}

export async function saveIgCreationIds(targetId: string, creationIds: Record<string, string>): Promise<void> {
  const { error } = await getSupabase()
    .from("publication_targets")
    .update({ ig_creation_ids: creationIds })
    .eq("id", targetId);
  if (error) throw new Error(`saveIgCreationIds: ${error.message}`);
}

export function allTargetsSettled(statuses: PublicationTargetStatus[]): boolean {
  return statuses.every((s) => s === "published" || s === "failed");
}
