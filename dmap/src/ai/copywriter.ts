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
      const output = copywriterOutputSchema.parse(json);
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
