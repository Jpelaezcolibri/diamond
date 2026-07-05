import sharp from "sharp";
import { z } from "zod";
import { logger } from "../lib/logger.js";
import { callClaude, type ClaudeCallResult } from "./claude.js";
import { tryParseJSON } from "./json-utils.js";
import { buildImageAnalysisPrompt, IMAGE_SELECTOR_PROMPT_VERSION } from "./prompts/image-selector.v1.js";
import { IMAGE_ANALYSIS_BATCH_SIZE, IMAGE_ANALYSIS_MAX_DIMENSION } from "../config/constants.js";
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

/**
 * Ranking determinista (NO decidido por el modelo): excluye oscuras y
 * duplicadas (se queda con la de mayor quality_score por grupo), y ordena
 * por prioridad de espacio y luego por calidad.
 */
export function rankImages(analyses: ImageAnalysis[]): ImageAnalysis[] {
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

  return [...uniques, ...bestByGroup.values()].sort((a, b) => {
    const priorityDiff = ROOM_PRIORITY[a.roomType] - ROOM_PRIORITY[b.roomType];
    if (priorityDiff !== 0) return priorityDiff;
    return b.qualityScore - a.qualityScore;
  });
}

/** cover/thumbnail = mejor foto; carousel = hasta 7; story = otra foto de buena calidad. */
export function selectAssets(analyses: ImageAnalysis[]): SelectedAssets | null {
  const ranked = rankImages(analyses);
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
