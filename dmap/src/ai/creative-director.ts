import { z } from "zod";
import { FatalError } from "../lib/errors.js";
import { callClaude, type ClaudeCallResult } from "./claude.js";
import { tryParseJSON } from "./json-utils.js";
import {
  buildCreativeDirectorPrompt,
  CREATIVE_DIRECTOR_PROMPT_VERSION,
  type CreativeDirectorInput
} from "./prompts/creative-director.v2.js";

/**
 * Agente 1 — Director Creativo (Claude). Nunca disena: construye el prompt
 * maestro para GPT Image. Mismo patron de agente que copywriter.ts (caller
 * inyectable, retry-una-vez si el JSON no parsea).
 */

const MAX_HEADLINE_WORDS = 7;

export const directorOutputSchema = z.object({
  master_prompt: z.string().min(200),
  // El limite de 7 palabras se aplica truncando (no tumbando la generacion):
  // un headline de 8 palabras no amerita perder la corrida completa.
  headline: z
    .string()
    .min(1)
    .transform((h) => h.split(/\s+/).slice(0, MAX_HEADLINE_WORDS).join(" ")),
  rationale: z.string().min(1)
});

export type DirectorOutput = z.infer<typeof directorOutputSchema>;

export interface GenerateMasterPromptResult {
  output: DirectorOutput;
  promptVersion: string;
  tokensIn: number;
  tokensOut: number;
}

type ClaudeCaller = (prompt: string) => Promise<ClaudeCallResult>;

const defaultCaller: ClaudeCaller = (prompt) => callClaude({ messages: [{ role: "user", content: prompt }], maxTokens: 3000 });

export async function generateMasterPrompt(
  input: CreativeDirectorInput,
  caller: ClaudeCaller = defaultCaller
): Promise<GenerateMasterPromptResult> {
  const prompt = buildCreativeDirectorPrompt(input);

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await caller(prompt);
    try {
      const json = tryParseJSON(result.text);
      const output = directorOutputSchema.parse(json);
      return { output, promptVersion: CREATIVE_DIRECTOR_PROMPT_VERSION, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
    } catch (err) {
      lastError = err;
    }
  }

  throw new FatalError(
    `Director creativo no produjo un prompt valido para ${input.property.ref} tras 2 intentos: ${(lastError as Error)?.message}`,
    lastError
  );
}
