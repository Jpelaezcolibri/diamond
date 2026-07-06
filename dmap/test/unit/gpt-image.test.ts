import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { editImage } from "../../src/ai/gpt-image.js";
import { env } from "../../src/config/env.js";
import { FatalError } from "../../src/lib/errors.js";

const PNG_1PX_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function okResponse(): Response {
  return new Response(JSON.stringify({ data: [{ b64_json: PNG_1PX_B64 }] }), { status: 200 });
}

const input = {
  imageBuffer: Buffer.from("fake-jpeg"),
  prompt: "Direccion de arte premium para apartamento en Sabaneta",
  size: "1024x1024" as const,
  quality: "high" as const
};

describe("editImage", () => {
  const originalKey = env.OPENAI_API_KEY;

  beforeEach(() => {
    // env es un objeto parseado una sola vez al boot — se muta directo en tests.
    (env as { OPENAI_API_KEY?: string }).OPENAI_API_KEY = "sk-test-123";
  });
  afterEach(() => {
    (env as { OPENAI_API_KEY?: string }).OPENAI_API_KEY = originalKey;
  });

  it("llama a /v1/images/edits con multipart correcto y devuelve el buffer decodificado", async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse());

    const result = await editImage(input, fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/images/edits");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer sk-test-123");

    const form = init.body as FormData;
    expect(form.get("model")).toBe(env.GPT_IMAGE_MODEL);
    expect(form.get("size")).toBe("1024x1024");
    expect(form.get("quality")).toBe("high");
    expect(form.get("n")).toBe("1");
    expect(form.get("prompt")).toContain("Sabaneta");
    expect(form.get("image")).toBeInstanceOf(Blob);

    expect(result.buffer).toEqual(Buffer.from(PNG_1PX_B64, "base64"));
    expect(result.model).toBe(env.GPT_IMAGE_MODEL);
    expect(result.sizeUsed).toBe("1024x1024");
  });

  it("401/429 de OpenAI -> FatalError con el mensaje de la API (el fallback es la politica, no el retry)", async () => {
    // Response fresco por llamada: el body de un Response solo se puede leer una vez.
    const fetchFn = vi
      .fn()
      .mockImplementation(async () => new Response(JSON.stringify({ error: { message: "You exceeded your current quota" } }), { status: 429 }));

    await expect(editImage(input, fetchFn)).rejects.toThrow(FatalError);
    await expect(editImage(input, fetchFn)).rejects.toThrow(/429.*quota/);
    expect(fetchFn).toHaveBeenCalledTimes(2); // una por cada expect — sin reintentos internos
  });

  it("error de red -> FatalError", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(editImage(input, fetchFn)).rejects.toThrow(/GPT Image no respondio/);
  });

  it("respuesta sin b64_json -> FatalError", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{}] }), { status: 200 }));
    await expect(editImage(input, fetchFn)).rejects.toThrow(/sin b64_json/);
  });

  it("sin OPENAI_API_KEY -> FatalError inmediato sin llamar a la red", async () => {
    (env as { OPENAI_API_KEY?: string }).OPENAI_API_KEY = undefined;
    const fetchFn = vi.fn();
    await expect(editImage(input, fetchFn)).rejects.toThrow(/OPENAI_API_KEY no configurada/);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
