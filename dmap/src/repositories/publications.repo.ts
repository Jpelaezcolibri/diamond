import { getSupabase } from "./supabase.js";
import type { PublicationRow } from "./types.js";
import type { PublicationStatus } from "../domain/publication-status.js";

export interface CreatePublicationInput {
  org_id: string;
  property_id: string | null;
  kind: PublicationRow["kind"];
  style_variant?: PublicationRow["style_variant"];
  copy_facebook?: string;
  copy_instagram?: string;
  titulo_comercial?: string;
  descripcion_comercial?: string;
  meta_title?: string;
  meta_description?: string;
  hashtags?: string[];
  cta?: string;
  template_id?: string;
  brand_profile_id?: string;
  created_by?: string;
}

export async function createPublication(input: CreatePublicationInput): Promise<PublicationRow> {
  const { data, error } = await getSupabase()
    .from("publications")
    .insert({ ...input, status: "draft" })
    .select()
    .single();
  if (error) throw new Error(`createPublication: ${error.message}`);
  return data as PublicationRow;
}

export async function getPublicationById(id: string): Promise<PublicationRow | null> {
  const { data, error } = await getSupabase().from("publications").select().eq("id", id).maybeSingle();
  if (error) throw new Error(`getPublicationById: ${error.message}`);
  return (data as PublicationRow) ?? null;
}

export async function updatePublicationStatus(id: string, status: PublicationStatus, extra: Record<string, unknown> = {}): Promise<void> {
  const { error } = await getSupabase()
    .from("publications")
    .update({ status, updated_at: new Date().toISOString(), ...extra })
    .eq("id", id);
  if (error) throw new Error(`updatePublicationStatus: ${error.message}`);
}

export async function updatePublicationContent(
  id: string,
  fields: Partial<
    Pick<
      PublicationRow,
      | "copy_facebook"
      | "copy_instagram"
      | "titulo_comercial"
      | "descripcion_comercial"
      | "meta_title"
      | "meta_description"
      | "hashtags"
      | "cta"
      | "style_variant"
    >
  >
): Promise<void> {
  const { error } = await getSupabase()
    .from("publications")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`updatePublicationContent: ${error.message}`);
}

export async function schedulePublication(id: string, scheduledAt: string, timezone: string): Promise<void> {
  const { error } = await getSupabase()
    .from("publications")
    .update({ scheduled_at: scheduledAt, timezone, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`schedulePublication: ${error.message}`);
}

/**
 * Claim atomico approved|scheduled -> publishing: solo el primer target que
 * arranca mueve el status de la publicacion, aunque varios targets de la
 * misma publicacion empiecen casi al mismo tiempo (mismo patron que
 * claimTargetForPublishing en publication-targets.repo.ts).
 */
export async function claimPublicationForPublishing(id: string): Promise<PublicationRow | null> {
  const { data, error } = await getSupabase()
    .from("publications")
    .update({ status: "publishing", updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["approved", "scheduled"])
    .select()
    .maybeSingle();
  if (error) throw new Error(`claimPublicationForPublishing: ${error.message}`);
  return (data as PublicationRow) ?? null;
}

export async function listPublicationsByOrgAndStatus(orgId: string, status?: PublicationStatus): Promise<PublicationRow[]> {
  let query = getSupabase().from("publications").select().eq("org_id", orgId);
  if (status) query = query.eq("status", status);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw new Error(`listPublicationsByOrgAndStatus: ${error.message}`);
  return (data as PublicationRow[]) ?? [];
}
