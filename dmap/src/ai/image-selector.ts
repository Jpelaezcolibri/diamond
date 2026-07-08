import sharp from "sharp";
import { z } from "zod";
import { logger } from "../lib/logger.js";
import { callClaude, type ClaudeCallResult } from "./claude.js";
import { tryParseJSON } from "./json-utils.js";
import { buildImageAnalysisPrompt, IMAGE_SELECTOR_PROMPT_VERSION } from "./prompts/image-selector.v1.js";
import { buildImageBriefFitPrompt, IMAGE_BRIEF_FIT_PROMPT_VERSION } from "./prompts/image-brief-fit.v1.js";
import { IMAGE_ANALYSIS_BATCH_SIZE, IMAGE_ANALYSIS_MAX_DIMENSION, IMAGE_BRIEF_FIT_CANDIDATE_LIMIT } from "../config/constants.js";
import { getSupabase } from "../repositories/supabase.js";

export type RoomType = "fachada" | "sala" | "cocina" | "balcon" | "vista" | "habitacion_principal" | "bano" | "otro";

export interface ImageAnalysis {
  imageUrl: string;
  roomType: RoomType;
  brightnessScore: number;
  qualityScore: number;
  isDark: boolean;
  /** Mismo valor en dos analisis => se consideran la misma toma; null = unica. */
  duplicateGroup: string | null;
}

export interface SelectedAssets {
  cover: string;
  carousel: string[];
  story: string;
  thumbnail: string;
}

export interface BriefFitScore {
  imageUrl: string;
  briefFitScore: number;
  reason: string;
}

/** Prioridad de tipo de espacio (ver dmap/ARCHITECTURE.md #6). Menor = mejor. */
const ROOM_PRIORITY: Record<RoomType, number> = {
  fachada: 0,
  sala: 1,
  cocina: 2,
  balcon: 3,
  vista: 3,
  habitacion_principal: 4,
  bano: 5,
  otro: 6
};

function legacyRank(pool: ImageAnalysis[]): ImageAnalysis[] {
  return [...pool].sort((a, b) => {
    const priorityDiff = ROOM_PRIORITY[a.roomType] - ROOM_PRIORITY[b.roomType];
    if (priorityDiff !== 0) return priorityDiff;
    return b.qualityScore - a.qualityScore;
  });
}

/**
 * Ranking determinista (NO decidido libremente por el modelo): excluye
 * oscuras y duplicadas (se queda con la de mayor quality_score por grupo), y
 * ordena por prioridad de espacio y luego por calidad.
 *
 * `briefFit` (opcional) viene de `scoreImagesForBrief` — cuando la propiedad
 * tiene direccion cognitiva (DCE), el ajuste a esa estrategia manda sobre
 * tipo de espacio/calidad (ver dmap/ARCHITECTURE.md #6): una foto
 * tecnicamente perfecta que contradice la direccion (ej. muestra interiores
 * cuando la estrategia pide contexto de paisaje) es peor eleccion que una
 * foto un poco menos nitida que si la sirve. Solo se reordenan las
 * candidatas que SI fueron evaluadas contra el brief (scoreImagesForBrief
 * acota a las top N por calidad, ver IMAGE_BRIEF_FIT_CANDIDATE_LIMIT) — el
 * resto conserva su lugar legacy al final, sin cambio de comportamiento
 * cuando no hay brief.
 */
export function rankImages(analyses: ImageAnalysis[], briefFit?: Map<string, BriefFitScore>): ImageAnalysis[] {
  const usable = analyses.filter((a) => !a.isDark);

  const uniques: ImageAnalysis[] = [];
  const bestByGroup = new Map<string, ImageAnalysis>();
  for (const a of usable) {
    if (!a.duplicateGroup) {
      uniques.push(a);
      continue;
    }
    const existing = bestByGroup.get(a.duplicateGroup);
    if (!existing || a.qualityScore > existing.qualityScore) {
      bestByGroup.set(a.duplicateGroup, a);
    }
  }

  const legacyRanked = legacyRank([...uniques, ...bestByGroup.values()]);
  if (!briefFit || briefFit.size === 0) return legacyRanked;

  const scored = legacyRanked.filter((a) => briefFit.has(a.imageUrl));
  const unscored = legacyRanked.filter((a) => !briefFit.has(a.imageUrl));
  scored.sort((a, b) => briefFit.get(b.imageUrl)!.briefFitScore - briefFit.get(a.imageUrl)!.briefFitScore);
  return [...scored, ...unscored];
}

/** cover/thumbnail = mejor foto; carousel = hasta 7; story = otra foto de buena calidad. */
export function selectAssets(analyses: ImageAnalysis[], briefFit?: Map<string, BriefFitScore>): SelectedAssets | null {
  const ranked = rankImages(analyses, briefFit);
  if (ranked.length === 0) return null;

  const cover = ranked[0]!.imageUrl;
  const carousel = ranked.slice(0, Math.min(7, ranked.length)).map((a) => a.imageUrl);
  const storyCandidate = ranked.find((a) => a.imageUrl !== cover) ?? ranked[0]!;

  return { cover, carousel, story: storyCandidate.imageUrl, thumbnail: cover };
}

const analysisArraySchema = z.array(
  z.object({
    index: z.number().int(),
    room_type: z.enum(["fachada", "sala", "cocina", "balcon", "vista", "habitacion_principal", "bano", "otro"]),
    brightness_score: z.number().min(0).max(100),
    quality_score: z.number().min(0).max(100),
    is_dark: z.boolean(),
    duplicate_of_index: z.number().int().nullable()
  })
);

async function downscaleToBase64(imageUrl: string): Promise<{ base64: string; mediaType: "image/jpeg" }> {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`No se pudo descargar ${imageUrl}: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const resized = await sharp(buffer)
    .resize({ width: IMAGE_ANALYSIS_MAX_DIMENSION, height: IMAGE_ANALYSIS_MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  return { base64: resized.toString("base64"), mediaType: "image/jpeg" };
}

type ClaudeCaller = (prompt: string, images: Array<{ base64: string; mediaType: "image/jpeg" }>) => Promise<ClaudeCallResult>;

const defaultCaller: ClaudeCaller = (prompt, images) =>
  callClaude({
    messages: [
      {
        role: "user",
        content: [
          ...images.map((img) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: img.mediaType, data: img.base64 }
          })),
          { type: "text" as const, text: prompt }
        ]
      }
    ],
    maxTokens: 2048
  });

/**
 * Analiza en batch las fotos no cacheadas de una propiedad (cache en
 * image_analysis_cache, una foto se analiza una sola vez en la vida) y
 * devuelve el analisis completo (cacheado + nuevo) listo para rankImages.
 */
export async function analyzeImages(
  orgId: string,
  propertyId: string,
  imageUrls: string[],
  caller: ClaudeCaller = defaultCaller
): Promise<ImageAnalysis[]> {
  const supabase = getSupabase();
  const { data: cached, error } = await supabase
    .from("image_analysis_cache")
    .select("image_url, analysis")
    .eq("property_id", propertyId);
  if (error) throw new Error(`analyzeImages (cache read): ${error.message}`);

  const cachedByUrl = new Map((cached ?? []).map((row) => [row.image_url as string, row.analysis as ImageAnalysis]));
  const pending = imageUrls.filter((url) => !cachedByUrl.has(url));
  const results: ImageAnalysis[] = imageUrls.filter((url) => cachedByUrl.has(url)).map((url) => cachedByUrl.get(url)!);

  for (let i = 0; i < pending.length; i += IMAGE_ANALYSIS_BATCH_SIZE) {
    const batch = pending.slice(i, i + IMAGE_ANALYSIS_BATCH_SIZE);
    const images = await Promise.all(batch.map(downscaleToBase64));
    const prompt = buildImageAnalysisPrompt(batch.length);
    const response = await caller(prompt, images);
    const parsed = analysisArraySchema.parse(tryParseJSON(response.text));

    const batchAnalyses: ImageAnalysis[] = parsed.map((item) => ({
      imageUrl: batch[item.index]!,
      roomType: item.room_type,
      brightnessScore: item.brightness_score,
      qualityScore: item.quality_score,
      isDark: item.is_dark,
      duplicateGroup:
        item.duplicate_of_index !== null && batch[item.duplicate_of_index]
          ? [batch[item.index], batch[item.duplicate_of_index]].sort().join("|")
          : null
    }));

    for (const analysis of batchAnalyses) {
      const { error: cacheError } = await supabase.from("image_analysis_cache").upsert({
        org_id: orgId,
        property_id: propertyId,
        image_url: analysis.imageUrl,
        analysis
      });
      if (cacheError) logger.warn({ err: cacheError.message }, "No se pudo cachear el analisis de imagen");
    }

    results.push(...batchAnalyses);
  }

  logger.debug({ propertyId, promptVersion: IMAGE_SELECTOR_PROMPT_VERSION, count: results.length }, "Analisis de imagenes completo");
  return results;
}

const briefFitArraySchema = z.array(
  z.object({
    index: z.number().int(),
    brief_fit_score: z.number().min(0).max(100),
    reason: z.string()
  })
);

/**
 * Evalua que tan bien cada foto sirve la direccion cognitiva de la propiedad
 * (mismo brief que reciben director y critico, ver
 * cognitive/application/briefs.ts#directorBriefFromContext) — sin esto,
 * rankImages es ciego a la estrategia y puede elegir una foto tecnicamente
 * buena que la contradice (ver dmap/ARCHITECTURE.md #6).
 *
 * Deliberadamente NO se cachea como analyzeImages: el brief cambia por
 * propiedad/corrida, cachear por foto sola mezclaria evaluaciones de briefs
 * distintos. Para acotar el costo de la llamada extra a Claude vision, solo
 * evalua las top `limit` candidatas del ranking legacy (ya filtrado de
 * oscuras/duplicadas) — no tiene sentido pagar por fotos que la calidad ya
 * descartaria.
 */
export async function scoreImagesForBrief(
  rankedCandidates: ImageAnalysis[],
  brief: string,
  caller: ClaudeCaller = defaultCaller,
  limit: number = IMAGE_BRIEF_FIT_CANDIDATE_LIMIT
): Promise<Map<string, BriefFitScore>> {
  const pool = rankedCandidates.slice(0, limit);
  const result = new Map<string, BriefFitScore>();
  if (pool.length === 0) return result;

  try {
    const images = await Promise.all(pool.map((c) => downscaleToBase64(c.imageUrl)));
    const prompt = buildImageBriefFitPrompt(brief, pool.length);
    const response = await caller(prompt, images);
    const parsed = briefFitArraySchema.parse(tryParseJSON(response.text));

    for (const item of parsed) {
      const candidate = pool[item.index];
      if (!candidate) continue;
      result.set(candidate.imageUrl, { imageUrl: candidate.imageUrl, briefFitScore: item.brief_fit_score, reason: item.reason });
    }
  } catch (err) {
    // No bloquea la generacion: sin scores, rankImages hace fallback al
    // ranking legacy (ver su firma) — una foto elegida por calidad/tipo de
    // espacio sigue siendo mejor que tumbar la corrida completa.
    logger.warn({ err }, "scoreImagesForBrief fallo — ranking cae a legacy (sin ajuste por brief)");
  }

  logger.debug({ promptVersion: IMAGE_BRIEF_FIT_PROMPT_VERSION, count: result.size }, "Brief-fit de imagenes completo");
  return result;
}

const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  fachada: "fachada",
  sala: "sala",
  cocina: "cocina",
  balcon: "balcon",
  vista: "vista/paisaje abierto",
  habitacion_principal: "habitacion principal",
  bano: "bano",
  otro: "otro/interior generico"
};

/**
 * Resumen legible del inventario REAL de fotos de una propiedad — insumo
 * para el DCE (narrative-direction.v1.ts): sin esto, la direccion creativa
 * se escribe solo a partir del texto de la propiedad y puede pedir un "hero
 * visual" (ej. "vista panoramica con horizonte") que ninguna foto real
 * contiene, condenando la pieza a repetir rechazos del critico para
 * siempre (ver dmap/ARCHITECTURE.md #6, seccion DCE). Cuenta por tipo de
 * espacio (mismo ROOM_TYPE que usa rankImages) para que el prompt sepa
 * exactamente que SI existe y que NO.
 */
export function summarizePhotoInventory(analyses: ImageAnalysis[]): string {
  const usable = analyses.filter((a) => !a.isDark);
  if (usable.length === 0) return "Sin fotos analizadas todavia — no asumas ningun elemento visual especifico.";

  const counts = new Map<RoomType, number>();
  for (const a of usable) counts.set(a.roomType, (counts.get(a.roomType) ?? 0) + 1);
  const parts = [...counts.entries()]
    .sort((a, b) => ROOM_PRIORITY[a[0]] - ROOM_PRIORITY[b[0]])
    .map(([type, n]) => `${ROOM_TYPE_LABELS[type]} x${n}`);
  return `Fotos reales disponibles (${usable.length}): ${parts.join(", ")}.`;
}
