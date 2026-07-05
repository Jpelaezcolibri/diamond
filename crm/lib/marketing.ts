import type { SupabaseClient } from "@supabase/supabase-js";

// Tipos espejo de dmap/src/repositories/types.ts — el CRM lee estas tablas
// directo de Supabase (ver dmap/ARCHITECTURE.md #13); las mutaciones van por
// /api/marketing/* hacia DMAP.

export type PublicationStatus =
  | "draft"
  | "approved"
  | "scheduled"
  | "publishing"
  | "published"
  | "partially_published"
  | "failed"
  | "archived";

export const PUBLICATION_STATUS_LABELS: Record<PublicationStatus, string> = {
  draft: "Generado",
  approved: "Aprobado",
  scheduled: "Programado",
  publishing: "Publicando",
  published: "Publicado",
  partially_published: "Publicado parcial",
  failed: "Error",
  archived: "Archivado",
};

export const PUBLICATION_STATUS_COLORS: Record<PublicationStatus, string> = {
  draft: "bg-slate-100 text-slate-700",
  approved: "bg-blue-100 text-blue-700",
  scheduled: "bg-amber-100 text-amber-700",
  publishing: "bg-amber-100 text-amber-700",
  published: "bg-emerald-100 text-emerald-700",
  partially_published: "bg-orange-100 text-orange-700",
  failed: "bg-red-100 text-red-700",
  archived: "bg-slate-100 text-slate-500",
};

export const STYLE_VARIANT_LABELS: Record<string, string> = {
  lujo: "Lujo",
  familiar: "Familiar",
  inversionista: "Inversionista",
  premium: "Premium",
  corporativo: "Corporativo",
};

export interface PublicationRow {
  id: string;
  org_id: string;
  property_id: string | null;
  kind: "single_image" | "carousel" | "story";
  status: PublicationStatus;
  style_variant: string | null;
  copy_facebook: string | null;
  copy_instagram: string | null;
  titulo_comercial: string | null;
  descripcion_comercial: string | null;
  meta_title: string | null;
  meta_description: string | null;
  hashtags: string[] | null;
  cta: string | null;
  scheduled_at: string | null;
  timezone: string;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicationAssetRow {
  id: string;
  publication_id: string;
  role: "cover" | "carousel" | "story" | "fb_cover" | "thumbnail";
  position: number;
  source_image_url: string | null;
  storage_path: string | null;
  public_url: string | null;
  width: number | null;
  height: number | null;
  format: string | null;
  alt_text: string | null;
  selected_by: "ai" | "user";
}

export interface PublicationEventRow {
  id: number;
  publication_id: string;
  org_id: string;
  from_status: string | null;
  to_status: string | null;
  actor: string;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface PropertyChangeEventRow {
  id: number;
  org_id: string;
  property_id: string | null;
  change_type: "created" | "price_changed" | "status_changed" | "photos_changed" | "description_changed" | "removed";
  old_value: unknown;
  new_value: unknown;
  processed: boolean;
  created_at: string;
}

export interface SyncRunRow {
  id: string;
  org_id: string;
  source: "wasi_api" | "wasi_public";
  status: "running" | "success" | "failed";
  started_at: string;
  finished_at: string | null;
  stats: { seen?: number; created?: number; updated?: number; removed?: number; errors?: number };
  error: string | null;
}

export interface SocialConnectionRow {
  id: string;
  org_id: string;
  platform: "facebook" | "instagram";
  external_account_id: string;
  external_account_name: string | null;
  linked_page_id: string | null;
  status: "connected" | "expired" | "error" | "revoked";
  last_validated_at: string | null;
  last_error: string | null;
}

export interface PublicationTargetRow {
  id: string;
  publication_id: string;
  social_connection_id: string;
  platform: "facebook" | "instagram";
  status: "pending" | "publishing" | "published" | "failed";
  external_post_id: string | null;
  permalink: string | null;
  attempts: number;
  last_error: string | null;
  published_at: string | null;
}

/** El CRM sigue siendo single-tenant (ver crm/ARCHITECTURE.md); esto resuelve
 *  la unica org existente, igual que src/data/organizations.js#getDefault() en el bot. */
export async function getDefaultOrgId(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase.from("organizations").select("id").limit(1).maybeSingle();
  return data?.id ?? null;
}
