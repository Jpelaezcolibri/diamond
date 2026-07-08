import { env } from "../../config/env.js";
import { CLAUDE_COST_PER_MTOK_IN_USD, CLAUDE_COST_PER_MTOK_OUT_USD } from "../../config/constants.js";
import { FatalError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { callClaude, type ClaudeCallResult } from "../../ai/claude.js";
import { tryParseJSON } from "../../ai/json-utils.js";
import { analyzeImages, summarizePhotoInventory } from "../../ai/image-selector.js";
import { computeContentHash, computeImagesHash } from "../../sync/hash.js";
import { getPropertyById, type PropertyRow } from "../../repositories/properties.repo.js";
import { recordContentGeneration } from "../../repositories/content-generations.repo.js";
import { resolveBrandProfile } from "../../creatives/brand.js";
import {
  audienceAnalysisOutputSchema,
  narrativeDirectionOutputSchema,
  propertyContextSchema,
  PROPERTY_CONTEXT_SCHEMA_VERSION,
  type PropertyContext
} from "../domain/property-context.js";
import { buildAudienceAnalysisPrompt, AUDIENCE_ANALYSIS_PROMPT_VERSION } from "../prompts/audience-analysis.v1.js";
import { buildNarrativeDirectionPrompt, NARRATIVE_DIRECTION_PROMPT_VERSION } from "../prompts/narrative-direction.v1.js";
import { deriveContext } from "./derive.rules.js";
import {
  getContextByPropertyId,
  listStaleContexts,
  upsertPropertyContext,
  type PropertyContextRow
} from "../repositories/property-context.repo.js";

/** Version compuesta de los prompts del builder — cambia si cambia cualquiera de los dos. */
export const CONTEXT_PROMPT_VERSION = `${AUDIENCE_ANALYSIS_PROMPT_VERSION}+${NARRATIVE_DIRECTION_PROMPT_VERSION}`;

type ClaudeCaller = (prompt: string) => Promise<ClaudeCallResult>;

const defaultCaller: ClaudeCaller = (prompt) => callClaude({ messages: [{ role: "user", content: prompt }], maxTokens: 4000 });

/**
 * Hash del contenido semantico de la propiedad tal como esta HOY en la tabla
 * `properties` (misma nocion que el diff del sync: contenido + imagenes).
 * Guardado en la fila del contexto, permite detectar drift ("el contexto se
 * genero sobre otra version de la propiedad") ademas de la invalidacion
 * activa que hace el sync.
 */
export function computeSourceHash(property: PropertyRow): string {
  const contentHash = computeContentHash({
    precio: property.precio,
    operacion: property.operacion,
    titulo: property.titulo,
    descripcion: property.descripcion,
    disponible: property.disponible,
    area: property.area,
    habitaciones: property.habitaciones,
    banos: property.banos,
    zona: property.zona
  });
  const imagesHash = computeImagesHash(property.images ?? []);
  return `${contentHash}:${imagesHash}`;
}

/** Mismo patron retry-una-vez del copywriter: el prompt no cambia entre intentos, pero un JSON malformado si. */
async function callAndParse<T>(
  prompt: string,
  parse: (json: unknown) => T,
  caller: ClaudeCaller,
  label: string
): Promise<{ output: T; tokensIn: number; tokensOut: number }> {
  let tokensIn = 0;
  let tokensOut = 0;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await caller(prompt);
    tokensIn += result.tokensIn;
    tokensOut += result.tokensOut;
    try {
      const json = tryParseJSON(result.text);
      return { output: parse(json), tokensIn, tokensOut };
    } catch (err) {
      lastError = err;
    }
  }
  throw new FatalError(`DCE (${label}) no produjo JSON valido tras 2 intentos: ${(lastError as Error)?.message}`, lastError);
}

export function estimateCostUsd(tokensIn: number, tokensOut: number): number {
  return Number(((tokensIn / 1_000_000) * CLAUDE_COST_PER_MTOK_IN_USD + (tokensOut / 1_000_000) * CLAUDE_COST_PER_MTOK_OUT_USD).toFixed(4));
}

export interface BuildContextDeps {
  caller?: ClaudeCaller;
  getProperty?: typeof getPropertyById;
  resolveBrand?: typeof resolveBrandProfile;
  upsertContext?: typeof upsertPropertyContext;
  getExisting?: typeof getContextByPropertyId;
  recordGeneration?: typeof recordContentGeneration;
  analyzeImages?: typeof analyzeImages;
}

/**
 * Orquestador del Diamond Cognitive Engine (Fase 1): propiedad -> llamada #1
 * (analisis de audiencia) -> llamada #2 (direccion narrativa) -> campos
 * derivados -> validacion contra el schema v${PROPERTY_CONTEXT_SCHEMA_VERSION} -> persistencia.
 *
 * Ante un fallo NUNCA pisa un contexto previo utilizable: si ya habia fila
 * con contenido queda en 'stale' (el batch nocturno reintenta); si no habia,
 * queda 'failed' con el error visible.
 */
export async function buildPropertyContext(
  orgId: string,
  propertyId: string,
  deps: BuildContextDeps = {}
): Promise<PropertyContextRow> {
  const caller = deps.caller ?? defaultCaller;
  const getProperty = deps.getProperty ?? getPropertyById;
  const resolveBrand = deps.resolveBrand ?? resolveBrandProfile;
  const upsertContext = deps.upsertContext ?? upsertPropertyContext;
  const getExisting = deps.getExisting ?? getContextByPropertyId;
  const recordGeneration = deps.recordGeneration ?? recordContentGeneration;
  const analyzeImagesFn = deps.analyzeImages ?? analyzeImages;

  const property = await getProperty(propertyId);
  if (!property) throw new FatalError(`Propiedad ${propertyId} no existe`);
  if (property.org_id !== orgId) throw new FatalError(`Propiedad ${propertyId} no pertenece a la org ${orgId}`);

  const brand = await resolveBrand(orgId);
  const derived = deriveContext(property);
  const sourceHash = computeSourceHash(property);

  try {
    // Inventario REAL de fotos (mismo analisis cacheado que usa el selector
    // de portada, ver image-selector.ts): sin esto la direccion narrativa se
    // escribe solo desde el texto y puede pedir un "hero visual" que ninguna
    // foto real puede mostrar, condenando la pieza a rechazo perpetuo del
    // critico (ver dmap/ARCHITECTURE.md #6, hallazgo Carmen de Viboral).
    const analyses = await analyzeImagesFn(orgId, propertyId, property.images ?? []).catch((err) => {
      logger.warn({ err, propertyId }, "DCE: no se pudo analizar fotos para el inventario — direccion narrativa sin ese insumo");
      return [];
    });
    const photoInventory = summarizePhotoInventory(analyses);

    const analysis = await callAndParse(
      buildAudienceAnalysisPrompt(property, derived, brand.name),
      (json) => audienceAnalysisOutputSchema.parse(json),
      caller,
      "analisis de audiencia"
    );

    const direction = await callAndParse(
      buildNarrativeDirectionPrompt(property, derived, analysis.output, brand.name, photoInventory),
      (json) => narrativeDirectionOutputSchema.parse(json),
      caller,
      "direccion narrativa"
    );

    const context: PropertyContext = propertyContextSchema.parse({
      ...analysis.output,
      ...direction.output,
      derived
    });

    const tokensIn = analysis.tokensIn + direction.tokensIn;
    const tokensOut = analysis.tokensOut + direction.tokensOut;
    const costUsd = estimateCostUsd(tokensIn, tokensOut);

    const row = await upsertContext({
      org_id: orgId,
      property_id: propertyId,
      property_ref: property.ref,
      prompt_version: CONTEXT_PROMPT_VERSION,
      source_hash: sourceHash,
      status: "ready",
      context,
      error: null,
      model: env.CLAUDE_MODEL,
      input_tokens: tokensIn,
      output_tokens: tokensOut,
      cost_usd: costUsd
    });

    // Historial/observabilidad — si falla no se descarta el contexto ya pagado.
    try {
      await recordGeneration({
        org_id: orgId,
        property_id: propertyId,
        kind: "property_context",
        model: env.CLAUDE_MODEL,
        prompt_version: CONTEXT_PROMPT_VERSION,
        input: { ref: property.ref, sourceHash, derived },
        output: context,
        tokens_in: tokensIn,
        tokens_out: tokensOut
      });
    } catch (err) {
      logger.warn({ err, propertyId }, "No se pudo registrar el contexto en content_generations");
    }

    logger.info({ orgId, ref: property.ref, tokensIn, tokensOut, costUsd }, "DCE: Property Context generado");
    return row;
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    const existing = await getExisting(orgId, propertyId);
    const hasUsableContext = existing && existing.context && Object.keys(existing.context).length > 0;
    await upsertContext({
      org_id: orgId,
      property_id: propertyId,
      property_ref: property.ref,
      prompt_version: existing?.prompt_version ?? CONTEXT_PROMPT_VERSION,
      source_hash: existing?.source_hash ?? sourceHash,
      status: hasUsableContext ? "stale" : "failed",
      context: hasUsableContext ? existing.context : {},
      error: message,
      model: existing?.model ?? null,
      input_tokens: existing?.input_tokens ?? null,
      output_tokens: existing?.output_tokens ?? null,
      cost_usd: existing?.cost_usd ?? null
    });
    throw err;
  }
}

export interface RebuildStaleStats {
  found: number;
  rebuilt: number;
  skipped: number;
  errors: number;
}

/**
 * Batch nocturno (politica del usuario: regenerar en lote, no al instante):
 * regenera los contextos 'stale'/'failed' de la org, EN SERIE — el costo por
 * contexto es bajo pero regenerar 40 en paralelo es un pico de rate-limit de
 * Claude sin necesidad (nadie espera este job). Propiedades ya no disponibles
 * se saltan: se regeneraran si vuelven al inventario.
 */
export async function rebuildStaleContexts(orgId: string, deps: BuildContextDeps = {}): Promise<RebuildStaleStats> {
  const getProperty = deps.getProperty ?? getPropertyById;
  const stale = await listStaleContexts(orgId);
  const stats: RebuildStaleStats = { found: stale.length, rebuilt: 0, skipped: 0, errors: 0 };

  for (const row of stale) {
    try {
      const property = await getProperty(row.property_id);
      if (!property || !property.disponible) {
        stats.skipped += 1;
        continue;
      }
      await buildPropertyContext(orgId, row.property_id, deps);
      stats.rebuilt += 1;
    } catch (err) {
      stats.errors += 1;
      logger.warn({ err, propertyId: row.property_id, ref: row.property_ref }, "DCE: fallo regenerando contexto stale");
    }
  }

  logger.info({ orgId, ...stats }, "DCE: batch de contextos stale terminado");
  return stats;
}
