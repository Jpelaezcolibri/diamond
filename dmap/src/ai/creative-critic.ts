import { z } from "zod";
import { callClaude, type ClaudeCallResult } from "./claude.js";
import { tryParseJSON } from "./json-utils.js";
import { buildCriticPrompt, CREATIVE_CRITIC_PROMPT_VERSION, type CreativeCriticContext } from "./prompts/creative-critic.v1.js";

/**
 * Agente 3 — Critico Creativo (Claude vision): evalua la pieza generada por
 * GPT Image contra la rubrica Diamond. Mismo patron vision que
 * image-selector.ts (imagen base64 + prompt, caller inyectable).
 *
 * A diferencia del director/copywriter, el critico NUNCA tumba el motor: si
 * tras 2 intentos su respuesta no parsea, degrada a score 0 ("critico
 * ilegible") — la pieza queda como no aprobada y la decide un humano, que
 * es estrictamente mejor que perder la generacion ya pagada.
 */

export const criticOutputSchema = z.object({
  score: z.number().min(0).max(100),
  veredicto: z.enum(["aprobado", "rechazado"]),
  problemas: z.array(z.string()),
  instrucciones_de_mejora: z.array(z.string())
});

export type CriticOutput = z.infer<typeof criticOutputSchema>;

export interface CritiqueResult {
  output: CriticOutput;
  promptVersion: string;
  tokensIn: number;
  tokensOut: number;
}

export type VisionCaller = (prompt: string, imageBase64: string) => Promise<ClaudeCallResult>;

const defaultCaller: VisionCaller = (prompt, imageBase64) =>
  callClaude({
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } },
          { type: "text", text: prompt }
        ]
      }
    ],
    maxTokens: 1500
  });

export async function critiqueCreative(
  imageBase64: string,
  ctx: CreativeCriticContext,
  caller: VisionCaller = defaultCaller
): Promise<CritiqueResult> {
  const prompt = buildCriticPrompt(ctx);

  let tokensIn = 0;
  let tokensOut = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await caller(prompt, imageBase64);
    tokensIn += result.tokensIn;
    tokensOut += result.tokensOut;
    try {
      const json = tryParseJSON(result.text);
      const output = criticOutputSchema.parse(json);
      return { output, promptVersion: CREATIVE_CRITIC_PROMPT_VERSION, tokensIn, tokensOut };
    } catch {
      // reintenta una vez; si vuelve a fallar, degrada abajo
    }
  }

  return {
    output: {
      score: 0,
      veredicto: "rechazado",
      problemas: ["El critico no produjo una evaluacion legible tras 2 intentos"],
      instrucciones_de_mejora: []
    },
    promptVersion: CREATIVE_CRITIC_PROMPT_VERSION,
    tokensIn,
    tokensOut
  };
}
