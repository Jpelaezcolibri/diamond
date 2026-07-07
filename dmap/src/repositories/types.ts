import type { PublicationStatus, PublicationTargetStatus } from "../domain/publication-status.js";
import type { StyleVariant } from "../config/constants.js";

export type PublicationKind = "single_image" | "carousel" | "story";
export type AssetRole = "cover" | "carousel" | "story" | "fb_cover" | "thumbnail";
export type SocialPlatform = "facebook" | "instagram";
export type ConnectionStatus = "connected" | "expired" | "error" | "revoked";
export type SyncSource = "wasi_api" | "wasi_public";
export type PropertyChangeType =
  | "created"
  | "price_changed"
  | "status_changed"
  | "photos_changed"
  | "description_changed"
  | "removed";

export interface PublicationRow {
  id: string;
  org_id: string;
  property_id: string | null;
  kind: PublicationKind;
  status: PublicationStatus;
  style_variant: StyleVariant | null;
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
  template_id: string | null;
  brand_profile_id: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicationTargetRow {
  id: string;
  publication_id: string;
  social_connection_id: string;
  platform: SocialPlatform;
  status: PublicationTargetStatus;
  external_post_id: string | null;
  permalink: string | null;
  ig_creation_ids: Record<string, string> | null;
  attempts: number;
  last_error: string | null;
  published_at: string | null;
}

export interface PublicationAssetRow {
  id: string;
  publication_id: string;
  role: AssetRole;
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

export interface SocialConnectionRow {
  id: string;
  org_id: string;
  platform: SocialPlatform;
  external_account_id: string;
  external_account_name: string | null;
  linked_page_id: string | null;
  access_token_enc: string;
  token_expires_at: string | null;
  scopes: string[];
  status: ConnectionStatus;
  last_validated_at: string | null;
  last_error: string | null;
  connected_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SyncRunRow {
  id: string;
  org_id: string;
  source: SyncSource;
  status: "running" | "success" | "failed";
  started_at: string;
  finished_at: string | null;
  stats: { seen?: number; created?: number; updated?: number; removed?: number; errors?: number };
  error: string | null;
}

export interface PropertySyncStateRow {
  property_id: string;
  org_id: string;
  wasi_id: string | null;
  content_hash: string | null;
  images_hash: string | null;
  raw: Record<string, unknown> | null;
  last_seen_at: string;
}

export interface PropertyChangeEventRow {
  id: number;
  org_id: string;
  property_id: string | null;
  sync_run_id: string | null;
  change_type: PropertyChangeType;
  old_value: unknown;
  new_value: unknown;
  processed: boolean;
  created_at: string;
}

export type CreativeEngine = "ai" | "template" | "hybrid" | "designer";

export interface OrgMarketingSettingsRow {
  org_id: string;
  auto_generate_on_new_property: boolean;
  auto_generate_on_photo_change: boolean;
  publish_window: { days: number[]; from: string; to: string };
  timezone: string;
  sync_source: SyncSource;
  sync_interval_minutes: number;
  wasi_id_company_enc: string | null;
  wasi_token_enc: string | null;
  // Motor de creativos: "ai" (multiagente GPT Image, default), "hybrid"
  // (Gemini mejora la foto + plantilla pone el texto), "designer" (solo
  // plantilla disenada por Claude, $0) o "template" (plantilla clasica).
  // "ai" degrada a template si falta OPENAI_API_KEY; "hybrid" degrada a
  // designer si falta GEMINI_API_KEY.
  creative_engine: CreativeEngine;
}

export interface BrandProfileRow {
  id: string;
  org_id: string;
  name: string;
  is_default: boolean;
  logo_url: string | null;
  colors: { primary: string; accent: string; text: string };
  fonts: { heading: string; body: string };
  layout_style: string;
  overlays: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
