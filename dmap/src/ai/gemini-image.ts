import { env } from "../config/env.js";
import { FatalError } from "../lib/errors.js";
import { GPT_IMAGE_TIMEOUT_MS } from "../config/constants.js";

/**
 * Cliente de Gemini Image (Nano Banana) para el motor "hybrid": recibe la
 * foto real y un prompt de mejora fotografica SIN TEXTO, devuelve la foto
 * embellecida (la plantilla satori pone el texto despues — designer-engine).
 *
 * fetch puro contra generateContent (mismo criterio que gpt-image.ts: un
 * endpoint no justifica un SDK). Errores -> FatalError SIEMPRE: la politica
 * del orquestador ante un fallo de Gemini es seguir con la foto original
 * (la pieza sale igual, solo sin el retoque), nunca tumbar la generacion.
 */

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/** Blindaje anexado a TODO prompt de mejora: sin texto y sin tocar la propiedad. */
const NO_TEXT_GUARD =
  "STRICT RULES: Do NOT add any text, letters, numbers, words, logos, watermarks or graphic overlays. " +
  "Do NOT alter, add or remove any structural element of the property (walls, furniture, windows, facade, layout must stay identical). " +
  "Only improve lighting, color grading and atmosphere. Return the edited photograph only.";

export interface GeminiEnhanceInput {
  /** Foto real de la propiedad, ya recortada al ratio destino. */
  imageBuffer: Buffer;
  /** Instrucciones de mejora fotografica (design spec `photo_prompt`). */
  prompt: string;
}

export interface GeminiEnhanceResult {
  buffer: Buffer;
  model: string;
}

export function isGeminiImageConfigured(): boolean {
  return Boolean(env.GEMINI_API_KEY);
}

interface GeminiResponsePart {
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
  text?: string;
}

export function extractImageBase64(body: unknown): string | null {
  const parts = (body as { candidates?: Array<{ content?: { parts?: GeminiResponsePart[] } }> })?.candidates?.[0]?.content?.parts;
  if (!parts) return null;
  for (const part of parts) {
    // REST responde camelCase (inlineData) pero se acepta snake_case por si acaso.
    const data = part.inlineData?.data ?? part.inline_data?.data;
    if (data) return data;
  }
  return null;
}

export async function enhancePhoto(input: GeminiEnhanceInput, fetchFn: typeof fetch = fetch): Promise<GeminiEnhanceResult> {
  if (!env.GEMINI_API_KEY) {
    throw new FatalError("GEMINI_API_KEY no configurada — mejora de foto no disponible");
  }

  const url = `${GEMINI_BASE_URL}/${env.GEMINI_IMAGE_MODEL}:generateContent`;
  const payload = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: "image/jpeg", data: input.imageBuffer.toString("base64") } },
          { text: `${input.prompt.trim()}\n\n${NO_TEXT_GUARD}` }
        ]
      }
    ]
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GPT_IMAGE_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (err) {
    const reason = (err as Error).name === "AbortError" ? `timeout tras ${GPT_IMAGE_TIMEOUT_MS}ms` : (err as Error).message;
    throw new FatalError(`Gemini Image no respondio: ${reason}`, err);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new FatalError(`Gemini Image respondio ${response.status}: ${body.error?.message ?? "sin detalle"}`);
  }

  const body = (await response.json()) as unknown;
  const b64 = extractImageBase64(body);
  if (!b64) {
    throw new FatalError("Gemini Image respondio sin imagen en candidates[0].content.parts");
  }

  return { buffer: Buffer.from(b64, "base64"), model: env.GEMINI_IMAGE_MODEL };
}
