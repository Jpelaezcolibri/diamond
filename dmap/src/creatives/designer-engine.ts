import {
  AI_ENGINE_MAX_ROUNDS,
  CREATIVE_SIZES,
  CRITIC_APPROVAL_THRESHOLD,
  type GptImageSizeKey
} from "../config/constants.js";
import { logger } from "../lib/logger.js";
import { generateDesignSpec, type DesignSpec, type GenerateDesignSpecResult } from "../ai/creative-designer.js";
import { critiqueCreative } from "../ai/creative-critic.js";
import { enhancePhoto, isGeminiImageConfigured } from "../ai/gemini-image.js";
import type { CreativeDirectorInput } from "../ai/prompts/creative-director.v1.js";
import { designerLayout } from "./layouts/designer.js";
import { renderSatoriTree } from "./renderer.js";
import { composeLogoAndResize, prepareSourceForEdit, toCriticBase64 } from "./compose.js";
import type { AiCreativeResult, AiCreativeRound } from "./ai-engine.js";
import type { BrandProfile } from "./brand.js";

/**
 * Orquestador de los motores "designer" e "hybrid" (alternativas de bajo
 * costo al motor "ai" de GPT Image — decision del usuario 2026-07-06 tras
 * el gasto de ~USD 5/dia):
 *
 * - designer: Disenador (Claude) produce un design spec -> la plantilla
 *   satori lo renderiza sobre la FOTO REAL -> Critico (Claude vision)
 *   evalua. Costo por imagen: $0 (solo tokens de Claude).
 * - hybrid: identico, pero antes de renderizar Gemini (Nano Banana)
 *   embellece la foto SIN TEXTO (~$0.039). Si Gemini falla, sigue con la
 *   foto original — la pieza sale igual.
 *
 * El texto SIEMPRE lo dibuja satori: imposible que salga "Banos" sin tilde
 * o un headline cortado (la causa #1 de rechazos del critico con GPT Image).
 * En rondas siguientes solo se re-disena el spec (la foto mejorada se
 * reusa — no se paga Gemini dos veces). Devuelve el mismo shape que
 * ai-engine (AiCreativeResult) para que generation.service registre y suba
 * el asset por el mismo camino.
 *
 * Cualquier excepcion (salvo Gemini) sube tal cual: el fallback a plantilla
 * clasica vive en generation.service, igual que con el motor "ai".
 */

export type DesignerEngineMode = "designer" | "hybrid";

export interface DesignerEngineDeps {
  designer?: typeof generateDesignSpec;
  critic?: typeof critiqueCreative;
  enhance?: typeof enhancePhoto;
  geminiConfigured?: typeof isGeminiImageConfigured;
  fetchFn?: typeof fetch;
}

export interface DesignerCreativeResult extends AiCreativeResult {
  /** true si la foto paso por Gemini (solo modo hybrid con key configurada). */
  photoEnhanced: boolean;
  /** Design spec de la mejor ronda — trazabilidad en content_generations. */
  designSpec: DesignSpec;
}

async function downloadBuffer(url: string, fetchFn: typeof fetch): Promise<Buffer> {
  const response = await fetchFn(url);
  if (!response.ok) throw new Error(`No se pudo descargar ${url}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function generateDesignerCreative(
  brand: BrandProfile,
  directorInput: CreativeDirectorInput,
  sourceImageUrl: string,
  sizeKey: GptImageSizeKey,
  mode: DesignerEngineMode,
  deps: DesignerEngineDeps = {},
  /** Notas del humano (Content Studio) — mandan sobre los defaults en TODAS las rondas. */
  userNotes?: string,
  /** Correcciones del critico de una corrida ANTERIOR (boton "corregir"). */
  criticFeedback?: string[]
): Promise<DesignerCreativeResult> {
  const designer = deps.designer ?? generateDesignSpec;
  const critic = deps.critic ?? critiqueCreative;
  const enhance = deps.enhance ?? enhancePhoto;
  const geminiConfigured = deps.geminiConfigured ?? isGeminiImageConfigured;
  const fetchFn = deps.fetchFn ?? fetch;

  const size = CREATIVE_SIZES[sizeKey];

  // 1. Primer diseno (incluye photo_prompt para el modo hibrido).
  let designed: GenerateDesignSpecResult = await designer({
    ...directorInput,
    ...(userNotes?.trim() ? { userNotes: userNotes.trim() } : {}),
    ...(criticFeedback?.length ? { criticInstructions: criticFeedback } : {})
  });
  let tokensIn = designed.tokensIn;
  let tokensOut = designed.tokensOut;

  // 2. Foto real recortada al tamano final + logo (mismos insumos que ai-engine).
  const sourceBuffer = await downloadBuffer(sourceImageUrl, fetchFn);
  let photoBuffer = await prepareSourceForEdit(sourceBuffer, `${size.width}x${size.height}`);

  let photoEnhanced = false;
  if (mode === "hybrid" && geminiConfigured()) {
    try {
      const enhanced = await enhance({ imageBuffer: photoBuffer, prompt: designed.output.photo_prompt });
      // Gemini puede devolver otra resolucion: se re-encuadra al tamano final.
      photoBuffer = await prepareSourceForEdit(enhanced.buffer, `${size.width}x${size.height}`);
      photoEnhanced = true;
    } catch (err) {
      logger.warn({ err, sourceImageUrl }, "Gemini no pudo mejorar la foto — la pieza sale con la foto original");
    }
  }

  let logoBuffer: Buffer | null = null;
  if (brand.logoUrl) {
    try {
      logoBuffer = await downloadBuffer(brand.logoUrl, fetchFn);
    } catch (err) {
      logger.warn({ err, logoUrl: brand.logoUrl }, "Logo de marca no descargable — la pieza sale sin logo");
    }
  }

  // 3. Loop disenar -> renderizar -> criticar. La foto (mejorada o no) se
  //    reusa entre rondas: solo cambia el spec segun el feedback del critico.
  const photoDataUri = `data:image/jpeg;base64,${photoBuffer.toString("base64")}`;
  const rounds: AiCreativeRound[] = [];
  let best: { composed: Awaited<ReturnType<typeof composeLogoAndResize>>; score: number; spec: DesignSpec } | null = null;

  for (let round = 1; round <= AI_ENGINE_MAX_ROUNDS; round++) {
    const tree = designerLayout(brand, designed.output, directorInput.property.ref, photoDataUri, size);
    const rendered = await renderSatoriTree(tree, size);
    const composed = await composeLogoAndResize(rendered.buffer, logoBuffer, sizeKey);

    const critique = await critic(await toCriticBase64(composed.buffer), {
      property: directorInput.property,
      headline: designed.output.headline,
      format: directorInput.format,
      engine: mode,
      ...(directorInput.cognitiveBrief ? { cognitiveBrief: directorInput.cognitiveBrief } : {})
    });
    tokensIn += critique.tokensIn;
    tokensOut += critique.tokensOut;

    rounds.push({
      round,
      score: critique.output.score,
      veredicto: critique.output.veredicto,
      problemas: critique.output.problemas,
      instrucciones_de_mejora: critique.output.instrucciones_de_mejora
    });

    if (!best || critique.output.score > best.score) {
      best = { composed, score: critique.output.score, spec: designed.output };
    }

    if (critique.output.score >= CRITIC_APPROVAL_THRESHOLD) {
      break;
    }

    if (round < AI_ENGINE_MAX_ROUNDS && critique.output.instrucciones_de_mejora.length > 0) {
      // Re-diseno con las instrucciones FRESCAS del critico (reemplazan las
      // de la corrida anterior); las notas del humano se mantienen siempre.
      designed = await designer({
        ...directorInput,
        ...(userNotes?.trim() ? { userNotes: userNotes.trim() } : {}),
        criticInstructions: critique.output.instrucciones_de_mejora
      });
      tokensIn += designed.tokensIn;
      tokensOut += designed.tokensOut;
    }
  }

  // best nunca es null: el loop corre al menos una ronda o lanzo antes.
  const finalScore = best!.score;
  return {
    buffer: best!.composed.buffer,
    width: best!.composed.width,
    height: best!.composed.height,
    format: "jpeg",
    approved: finalScore >= CRITIC_APPROVAL_THRESHOLD,
    finalScore,
    rounds,
    masterPrompt: best!.spec.photo_prompt,
    headline: best!.spec.headline,
    rationale: best!.spec.rationale,
    promptVersion: designed.promptVersion,
    tokensIn,
    tokensOut,
    logoApplied: Boolean(logoBuffer),
    photoEnhanced,
    designSpec: best!.spec
  };
}
