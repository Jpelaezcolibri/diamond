export const CREATIVE_SIZES = {
  fb_post: { width: 1200, height: 630 },
  ig_feed: { width: 1080, height: 1080 },
  ig_story: { width: 1080, height: 1920 },
  fb_cover: { width: 820, height: 312 }
} as const;

export type CreativeSizeKey = keyof typeof CREATIVE_SIZES;

export const DEFAULT_SYNC_INTERVAL_MINUTES = 60;
export const METRICS_INTERVAL_HOURS = 6;
export const TOKEN_REFRESH_INTERVAL_DAYS = 7;

export const IG_MAX_CAROUSEL_ITEMS = 10;
export const IG_DAILY_PUBLISH_QUOTA = 50;

export const PUBLISH_RETRY_BACKOFF_MS = [30_000, 120_000, 480_000, 1_800_000, 7_200_000];
export const PUBLISH_MAX_ATTEMPTS = PUBLISH_RETRY_BACKOFF_MS.length;

export const GRAPH_API_VERSION = "v21.0";
export const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export const IMAGE_ANALYSIS_MAX_DIMENSION = 1024;
export const IMAGE_ANALYSIS_BATCH_SIZE = 12;

export const STYLE_VARIANTS = [
  "lujo",
  "familiar",
  "inversionista",
  "premium",
  "corporativo"
] as const;

export type StyleVariant = (typeof STYLE_VARIANTS)[number];

/** Scopes adicionales sobre la Meta App existente de WhatsApp — ver dmap/ARCHITECTURE.md #8. */
export const META_OAUTH_SCOPES = [
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
  "read_insights",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_insights",
  "business_management"
] as const;

/** Dias de vida restante del user token por debajo de los cuales se re-exchange proactivamente (~60d de vida total). */
export const META_TOKEN_REFRESH_THRESHOLD_DAYS = 15;
