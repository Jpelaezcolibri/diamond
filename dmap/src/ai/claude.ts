import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env.js";
import { RetryableError } from "../lib/errors.js";

let client: Anthropic | null = null;

export function getClaudeClient(): Anthropic {
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

export interface ClaudeCallInput {
  system?: string;
  messages: Anthropic.MessageParam[];
  maxTokens?: number;
}

export interface ClaudeCallResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

/** Wrapper minimo sobre el SDK: extrae el texto y contabiliza tokens (ver content_generations). */
export async function callClaude(input: ClaudeCallInput): Promise<ClaudeCallResult> {
  try {
    const response = await getClaudeClient().messages.create({
      model: env.CLAUDE_MODEL,
      max_tokens: input.maxTokens ?? 2048,
      system: input.system,
      messages: input.messages
    });
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    return {
      text,
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens
    };
  } catch (err) {
    // Errores de red/5xx/rate-limit de Anthropic son reintentables (ver lib/errors.ts).
    throw new RetryableError("Fallo la llamada a Claude", err);
  }
}
