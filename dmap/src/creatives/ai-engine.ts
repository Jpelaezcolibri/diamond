import {
  AI_ENGINE_MAX_ROUNDS,
  CRITIC_APPROVAL_THRESHOLD,
  GPT_IMAGE_QUALITY,
  GPT_IMAGE_SIZES,
  type GptImageSizeKey
} from "../config/constants.js";
import { logger } from "../lib/logger.js";
import { generateMasterPrompt } from "../ai/creative-director.js";
import { critiqueCreative, type CriticOutput } from "../ai/creative-critic.js";
import { editImage } from "../ai/gpt-image.js";
import type { CreativeDirectorInput } from "../ai/prompts/creative-director.v1.js";
import { composeLogoAndResize, prepareSourceForEdit, toCriticBase64 } from "./compose.js";
import type { BrandProfile } from "./brand.js";

/**
 * Orquestador del motor multiagente de creativos (ver plan "Diamond AI
 * Creative Director"): Director (Claude) construye el prompt maestro ->
 * GPT Image genera sobre la foto REAL -> sharp compone el logo real y
 * reescala a tamanos Meta -> Critico (Claude vision) evalua. Maximo
 * AI_ENGINE_MAX_ROUNDS rondas; en la segunda, el prompt lleva las
 * instrucciones de mejora del critico (sin re-llamar al director). Si
 * ninguna ronda aprueba: gana la de mayor score con approved:false (la
 * decision final es humana en el Content Studio).
 *
 * Cualquier excepcion sube tal cual: la politica de reintento del motor es
 * el fallback a plantilla en generation.service, no reintentar aqui.
 */

export interface AiEngineDeps {
  director?: typeof generateMasterPrompt;
  imageEditor?: typeof editImage;
  critic?: typeof critiqueCreative;
  fetchFn?: typeof fetch;
}

export interface AiCreativeRound {
  round: number;
  score: number;
  veredicto: CriticOutput["veredicto"];
  problemas: string[];
  instrucciones_de_mejora: string[];
}

export interface AiCreativeResult {
  buffer: Buffer;
  width: number;
  height: number;
  format: "jpeg";
  approved: boolean;
  finalScore: number;
  rounds: AiCreativeRound[];
  masterPrompt: string;
  headline: string;
  rationale: string;
  promptVersion: string;
  tokensIn: number;
  tokensOut: number;
  logoApplied: boolean;
}

async function downloadBuffer(url: string, fetchFn: typeof fetch): Promise<Buffer> {
  const response = await fetchFn(url);
  if (!response.ok) throw new Error(`No se pudo descargar ${url}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Compone el prompt de una ronda: prompt maestro del director + (opcional)
 * notas del humano + (opcional) correcciones del critico de la ronda previa.
 * Las notas del humano se mantienen en TODAS las rondas (son la voluntad del
 * cliente, no un feedback puntual) y tienen prioridad sobre los defaults de
 * estilo cuando choquen.
 */
export function composeRoundPrompt(masterPrompt: string, userNotes: string | undefined, criticInstructions: string[]): string {
  let prompt = masterPrompt;
  if (userNotes && userNotes.trim()) {
    prompt += `\n\nART DIRECTOR NOTES (from the human client — MANDATORY, honor these exactly; they OVERRIDE the style defaults wherever they conflict):\n${userNotes.trim()}`;
  }
  if (criticInstructions.length > 0) {
    prompt += `\n\nMANDATORY CORRECTIONS FROM PREVIOUS ROUND (a senior art director rejected the last attempt — fix ALL of these; where a correction conflicts with any instruction above, the CORRECTION wins):\n- ${criticInstructions.join("\n- ")}`;
  }
  return prompt;
}

export async function generateAiCreative(
  brand: BrandProfile,
  directorInput: CreativeDirectorInput,
  sourceImageUrl: string,
  sizeKey: GptImageSizeKey,
  deps: AiEngineDeps = {},
  /** Instrucciones del humano (Content Studio) — se inyectan en TODAS las
   *  rondas con prioridad sobre el estilo. undefined = generacion normal. */
  userNotes?: string,
  /** Correcciones del critico de una corrida ANTERIOR (boton "corregir con
   *  las recomendaciones del critico" del Content Studio): entran como
   *  MANDATORY CORRECTIONS desde la ronda 1. En rondas siguientes las
   *  reemplazan las instrucciones frescas del critico de esta corrida. */
  criticFeedback?: string[]
): Promise<AiCreativeResult> {
  const director = deps.director ?? generateMasterPrompt;
  const imageEditor = deps.imageEditor ?? editImage;
  const critic = deps.critic ?? critiqueCreative;
  const fetchFn = deps.fetchFn ?? fetch;

  // 1. Director Creativo: prompt maestro (una vez por rol — feed y story
  //    tienen composicion distinta y el input ya trae el formato).
  const directed = await director(directorInput);
  let tokensIn = directed.tokensIn;
  let tokensOut = directed.tokensOut;

  // 2. Insumos compartidos entre rondas: foto real recortada al ratio GPT y
  //    logo real (si el logo no descarga, se sigue sin el — no aborta).
  const gptSize = GPT_IMAGE_SIZES[sizeKey];
  const sourceBuffer = await downloadBuffer(sourceImageUrl, fetchFn);
  const preparedSource = await prepareSourceForEdit(sourceBuffer, gptSize);

  let logoBuffer: Buffer | null = null;
  if (brand.logoUrl) {
    try {
      logoBuffer = await downloadBuffer(brand.logoUrl, fetchFn);
    } catch (err) {
      logger.warn({ err, logoUrl: brand.logoUrl }, "Logo de marca no descargable — la pieza sale sin logo");
    }
  }

  // 3. Loop generar -> componer -> criticar.
  const rounds: AiCreativeRound[] = [];
  let best: { composed: Awaited<ReturnType<typeof composeLogoAndResize>>; score: number } | null = null;
  let prompt = composeRoundPrompt(directed.output.master_prompt, userNotes, criticFeedback ?? []);

  for (let round = 1; round <= AI_ENGINE_MAX_ROUNDS; round++) {
    const generated = await imageEditor({
      imageBuffer: preparedSource,
      prompt,
      size: gptSize,
      quality: GPT_IMAGE_QUALITY
    });

    const composed = await composeLogoAndResize(generated.buffer, logoBuffer, sizeKey);

    const critique = await critic(await toCriticBase64(composed.buffer), {
      property: directorInput.property,
      headline: directed.output.headline,
      format: directorInput.format,
      engine: "ai",
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
      best = { composed, score: critique.output.score };
    }

    if (critique.output.score >= CRITIC_APPROVAL_THRESHOLD) {
      break;
    }

    if (round < AI_ENGINE_MAX_ROUNDS && critique.output.instrucciones_de_mejora.length > 0) {
      prompt = composeRoundPrompt(directed.output.master_prompt, userNotes, critique.output.instrucciones_de_mejora);
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
    masterPrompt: directed.output.master_prompt,
    headline: directed.output.headline,
    rationale: directed.output.rationale,
    promptVersion: directed.promptVersion,
    tokensIn,
    tokensOut,
    logoApplied: Boolean(logoBuffer)
  };
}
