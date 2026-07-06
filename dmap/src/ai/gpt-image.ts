import { env } from "../config/env.js";
import { FatalError } from "../lib/errors.js";
import { GPT_IMAGE_TIMEOUT_MS } from "../config/constants.js";

/**
 * Agente 2 — Director de Arte: cliente de OpenAI Images (gpt-image-1).
 *
 * Se usa /v1/images/edits (no /generations) porque la REGLA DURA del motor
 * es que la propiedad mostrada sea la REAL: la foto original entra como
 * imagen base y el modelo compone la direccion de arte encima.
 *
 * fetch puro (sin SDK de OpenAI): un solo endpoint multipart no justifica la
 * dependencia, y es el estilo del codebase (wasi sources, graph-client).
 * Errores -> FatalError SIEMPRE: el orquestador no reintenta OpenAI — la
 * politica ante cualquier fallo (sin key, sin creditos, timeout, 5xx) es
 * caer a la plantilla satori (decision del usuario).
 */

const OPENAI_IMAGES_EDIT_URL = "https://api.openai.com/v1/images/edits";

export interface GptImageEditInput {
  /** Foto real de la propiedad, ya recortada al ratio destino (compose.prepareSourceForEdit). */
  imageBuffer: Buffer;
  prompt: string;
  size: "1024x1024" | "1024x1536";
  quality?: "low" | "medium" | "high";
}

export interface GptImageResult {
  buffer: Buffer;
  model: string;
  sizeUsed: string;
}

export function isGptImageConfigured(): boolean {
  return Boolean(env.OPENAI_API_KEY);
}

export async function editImage(input: GptImageEditInput, fetchFn: typeof fetch = fetch): Promise<GptImageResult> {
  if (!env.OPENAI_API_KEY) {
    throw new FatalError("OPENAI_API_KEY no configurada — motor IA no disponible");
  }

  const form = new FormData();
  form.append("model", env.GPT_IMAGE_MODEL);
  form.append("image", new Blob([new Uint8Array(input.imageBuffer)], { type: "image/jpeg" }), "property.jpg");
  form.append("prompt", input.prompt);
  form.append("size", input.size);
  form.append("quality", input.quality ?? "high");
  form.append("n", "1");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GPT_IMAGE_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchFn(OPENAI_IMAGES_EDIT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: form,
      signal: controller.signal
    });
  } catch (err) {
    const reason = (err as Error).name === "AbortError" ? `timeout tras ${GPT_IMAGE_TIMEOUT_MS}ms` : (err as Error).message;
    throw new FatalError(`GPT Image no respondio: ${reason}`, err);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new FatalError(`GPT Image respondio ${response.status}: ${body.error?.message ?? "sin detalle"}`);
  }

  const body = (await response.json()) as { data?: Array<{ b64_json?: string }> };
  const b64 = body.data?.[0]?.b64_json;
  if (!b64) {
    throw new FatalError("GPT Image respondio sin b64_json en data[0]");
  }

  return { buffer: Buffer.from(b64, "base64"), model: env.GPT_IMAGE_MODEL, sizeUsed: input.size };
}
