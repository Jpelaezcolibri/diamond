import { z } from "zod";
import { FatalError } from "../lib/errors.js";
import { callClaude, type ClaudeCallResult } from "./claude.js";
import { tryParseJSON } from "./json-utils.js";
import { buildCopyPrompt, COPYWRITER_PROMPT_VERSION, type BrandVoiceInput, type CopywriterPropertyInput } from "./prompts/copywriter.v1.js";
import type { StyleVariant } from "../config/constants.js";

export const copywriterOutputSchema = z.object({
  copy_facebook: z.string().min(1),
  copy_instagram: z.string().min(1),
  titulo_comercial: z.string().min(1),
  descripcion_comercial: z.string().min(1),
  meta_title: z.string().min(1).max(70),
  meta_description: z.string().min(1).max(160),
  hashtags: z.array(z.string()).min(1),
  cta: z.string().min(1),
  alt_text_cover: z.string().min(1)
});

export type CopywriterOutput = z.infer<typeof copywriterOutputSchema>;

export interface GenerateCopyResult {
  output: CopywriterOutput;
  promptVersion: string;
  tokensIn: number;
  tokensOut: number;
}

type ClaudeCaller = (prompt: string) => Promise<ClaudeCallResult>;

const defaultCaller: ClaudeCaller = (prompt) => callClaude({ messages: [{ role: "user", content: prompt }] });

const META_LIMITS = { meta_title: 70, meta_description: 160 } as const;

/**
 * Recorte de seguridad para los campos SEO: el prompt le pide a Claude que
 * cuente caracteres exactos, pero un LLM no siempre cuenta bien — visto en
 * produccion (2026-07-06): meta_description se paso del limite y tumbo la
 * generacion completa 2 veces seguidas (el prompt no cambia entre intentos,
 * asi que el mismo error se repite). Recortar ANTES de validar con zod evita
 * depender de que el conteo del modelo sea perfecto.
 */
function truncateMetaFields(json: unknown): unknown {
  if (!json || typeof json !== "object") return json;
  const patched = { ...(json as Record<string, unknown>) };
  for (const [field, max] of Object.entries(META_LIMITS)) {
    const value = patched[field];
    if (typeof value === "string" && value.length > max) {
      patched[field] = value.slice(0, max).trim();
    }
  }
  return patched;
}

/**
 * Genera el copy de una propiedad en el estilo pedido. Reintenta UNA vez si
 * la respuesta no parsea como JSON valido (ver dmap/ARCHITECTURE.md #6).
 * `caller` es inyectable para poder testear el parseo/retry sin red.
 */
export async function generateCopy(
  property: CopywriterPropertyInput,
  styleVariant: StyleVariant,
  brand: BrandVoiceInput,
  caller: ClaudeCaller = defaultCaller
): Promise<GenerateCopyResult> {
  const prompt = buildCopyPrompt(property, styleVariant, brand);

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await caller(prompt);
    try {
      const json = tryParseJSON(result.text);
      const output = copywriterOutputSchema.parse(truncateMetaFields(json));
      return { output, promptVersion: COPYWRITER_PROMPT_VERSION, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
    } catch (err) {
      lastError = err;
    }
  }

  throw new FatalError(
    `No se pudo generar copy valido para ${property.ref} tras 2 intentos: ${(lastError as Error)?.message}`,
    lastError
  );
}
