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

/**
 * Reintentos del sync — incidente del 2026-08-22.
 *
 * Wasi devolvio un 502 en /property/search a las 00:00 UTC y el sync murio en 7
 * segundos. Sin reintentos, el proximo intento quedaba 24 h despues; a las 30 h
 * del ultimo sync exitoso el bot marca todo el inventario como `sync_viejo`
 * (src/groups/publicable.js) y el radar de grupos se calla. Un 502 de siete
 * segundos costo mas de nueve horas de radar mudo, con tres pedidos con match
 * sin responder.
 *
 * La escalera tiene que caber en el margen entre la cadencia del sync (24 h en
 * Diamond) y la ventana de frescura del bot (30 h): 6 h. Estos escalones suman
 * ~4.4 h de reintentos efectivos, asi que si se agotan todos todavia queda
 * tiempo para que el watchdog avise antes de que el radar enmudezca — y ahi el
 * problema en Wasi ya es real, no un hipo.
 *
 * El indice 0 casi nunca se usa: BullMQ llama la estrategia con `attemptsMade`,
 * que vale 1 en el primer reintento (mismo comportamiento que publish).
 */
export const SYNC_RETRY_BACKOFF_MS = [60_000, 300_000, 1_200_000, 3_600_000, 10_800_000];
export const SYNC_MAX_ATTEMPTS = SYNC_RETRY_BACKOFF_MS.length;

export const GRAPH_API_VERSION = "v21.0";
export const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export const IMAGE_ANALYSIS_MAX_DIMENSION = 1024;
export const IMAGE_ANALYSIS_BATCH_SIZE = 12;
/** Cuantas candidatas (ya rankeadas por calidad/tipo) se evaluan contra el brief cognitivo — acota el costo de la llamada extra a Claude vision. */
export const IMAGE_BRIEF_FIT_CANDIDATE_LIMIT = 8;

// ── Motor IA de creativos (Director/GPT Image/Critico) ──────────────────
/** Tamanos nativos de gpt-image-1 por rol; el resize final a los tamanos Meta lo hace sharp (compose.ts). */
export const GPT_IMAGE_SIZES = {
  ig_feed: "1024x1024",
  ig_story: "1024x1536"
} as const satisfies Partial<Record<CreativeSizeKey, string>>;

export type GptImageSizeKey = keyof typeof GPT_IMAGE_SIZES;

/** Maximo de rondas generar->criticar por creative (decision del usuario: 2 — cada ronda GPT Image cuesta ~$0.17). */
export const AI_ENGINE_MAX_ROUNDS = 2;
/** Maximo de rondas para designer/hybrid: las rondas extra son casi gratis (solo tokens de Claude — la foto de Gemini se reusa), asi que se permite una ronda mas de correccion que en "ai". */
export const DESIGNER_ENGINE_MAX_ROUNDS = 3;
/** Score minimo del critico (0-100) para aprobar sin revision humana. */
export const CRITIC_APPROVAL_THRESHOLD = 75;
/** Knob de costo: "high" ~USD 0.17/imagen, "medium" ~0.04. */
export const GPT_IMAGE_QUALITY = "high" as const;
export const GPT_IMAGE_TIMEOUT_MS = 120_000;
/** Ancho del logo compuesto (sharp) relativo al ancho del creative. */
export const LOGO_WIDTH_RATIO = 0.08;
/** Estimado para el historial de costos en content_generations (no facturado). */
export const COST_PER_GPT_IMAGE_USD = 0.17;
/** Gemini 2.5 Flash Image (Nano Banana): ~$0.039 por imagen 1K (pricing oficial jul 2026). */
export const COST_PER_GEMINI_IMAGE_USD = 0.039;

// ── Diamond Cognitive Engine (DCE) ───────────────────────────────────────
/** Estimado para cost_usd en property_contexts (precio Sonnet, no facturado). */
export const CLAUDE_COST_PER_MTOK_IN_USD = 3;
export const CLAUDE_COST_PER_MTOK_OUT_USD = 15;
/** Hora local (org_marketing_settings.timezone) del batch nocturno que regenera contextos stale/failed. */
export const COGNITIVE_REBUILD_CRON = "0 3 * * *";

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
