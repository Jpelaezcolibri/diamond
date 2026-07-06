import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { composeRoundPrompt, generateAiCreative, type AiEngineDeps } from "../../src/creatives/ai-engine.js";
import type { BrandProfile } from "../../src/creatives/brand.js";
import type { CreativeDirectorInput } from "../../src/ai/prompts/creative-director.v1.js";

const brand: BrandProfile = {
  id: null,
  name: "Diamond",
  logoUrl: null,
  colors: { primary: "#0b1526", accent: "#c9a24b", text: "#ffffff" },
  fonts: { heading: "Playfair Display", body: "Inter" },
  layoutStyle: "premium_strip"
};

const directorInput: CreativeDirectorInput = {
  property: {
    ref: "AP001",
    titulo: "Apartamento en Sabaneta",
    operacion: "Venta",
    precio: "$460.000.000",
    area: "65m2",
    habitaciones: 2,
    banos: 2,
    zona: "El Carmelo",
    ciudad: "Sabaneta",
    descripcion: null
  },
  styleVariant: "lujo",
  tituloComercial: "Apartamento con vista en Sabaneta",
  cta: "Agenda tu visita",
  format: "feed",
  brand: { name: "Diamond" }
};

async function syntheticJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 40, g: 60, b: 90 } } }).jpeg().toBuffer();
}

function makeDeps(overrides: Partial<AiEngineDeps> & { scores?: number[] } = {}): {
  deps: AiEngineDeps;
  director: ReturnType<typeof vi.fn>;
  imageEditor: ReturnType<typeof vi.fn>;
  critic: ReturnType<typeof vi.fn>;
} {
  const scores = overrides.scores ?? [90];
  let call = 0;

  const director = vi.fn().mockResolvedValue({
    output: { master_prompt: "M".repeat(300), headline: "Vive Sabaneta con estilo", rationale: "Editorial premium." },
    promptVersion: "creative-director.v1",
    tokensIn: 100,
    tokensOut: 300
  });

  const imageEditor = vi.fn().mockImplementation(async () => ({
    buffer: await syntheticJpeg(1024, 1024),
    model: "gpt-image-1",
    sizeUsed: "1024x1024"
  }));

  const critic = vi.fn().mockImplementation(async () => {
    const score = scores[Math.min(call, scores.length - 1)]!;
    call++;
    return {
      output: {
        score,
        veredicto: score >= 75 ? "aprobado" : "rechazado",
        problemas: score >= 75 ? [] : ["texto ilegible en la franja inferior"],
        instrucciones_de_mejora: score >= 75 ? [] : ["agranda el precio", "sube el contraste del headline"]
      },
      promptVersion: "creative-critic.v1",
      tokensIn: 50,
      tokensOut: 40
    };
  });

  // fetchFn atiende la descarga de la foto fuente (y del logo si aplica).
  const fetchFn = vi.fn().mockImplementation(async () => {
    const img = await syntheticJpeg(2000, 1500);
    return new Response(new Uint8Array(img), { status: 200 });
  });

  return {
    deps: { director, imageEditor, critic, fetchFn, ...overrides },
    director,
    imageEditor,
    critic
  };
}

describe("generateAiCreative", () => {
  it("aprueba en ronda 1: una sola llamada a GPT y al critico, resultado 1080x1080 approved", async () => {
    const { deps, director, imageEditor, critic } = makeDeps({ scores: [88] });

    const result = await generateAiCreative(brand, directorInput, "https://img.example/x.jpg", "ig_feed", deps);

    expect(director).toHaveBeenCalledTimes(1);
    expect(imageEditor).toHaveBeenCalledTimes(1);
    expect(critic).toHaveBeenCalledTimes(1);
    expect(result.approved).toBe(true);
    expect(result.finalScore).toBe(88);
    expect(result.width).toBe(1080);
    expect(result.height).toBe(1080);
    expect(result.rounds).toHaveLength(1);
    expect(result.logoApplied).toBe(false); // brand.logoUrl null
  });

  it("falla ronda 1 y aprueba ronda 2: el prompt de la 2a lleva las instrucciones del critico", async () => {
    const { deps, imageEditor, critic } = makeDeps({ scores: [60, 85] });

    const result = await generateAiCreative(brand, directorInput, "https://img.example/x.jpg", "ig_feed", deps);

    expect(imageEditor).toHaveBeenCalledTimes(2);
    expect(critic).toHaveBeenCalledTimes(2);
    const secondPrompt = imageEditor.mock.calls[1]![0].prompt as string;
    expect(secondPrompt).toContain("MANDATORY CORRECTIONS");
    expect(secondPrompt).toContain("agranda el precio");
    expect(result.approved).toBe(true);
    expect(result.finalScore).toBe(85);
    expect(result.rounds.map((r) => r.score)).toEqual([60, 85]);
  });

  it("ambas rondas fallan: NUNCA hay 3a llamada, devuelve la de mayor score con approved:false", async () => {
    const { deps, imageEditor, critic } = makeDeps({ scores: [55, 42] });

    const result = await generateAiCreative(brand, directorInput, "https://img.example/x.jpg", "ig_feed", deps);

    expect(imageEditor).toHaveBeenCalledTimes(2);
    expect(critic).toHaveBeenCalledTimes(2);
    expect(result.approved).toBe(false);
    expect(result.finalScore).toBe(55); // la mejor de las dos (ronda 1)
    expect(result.rounds).toHaveLength(2);
  });

  it("el editor lanza (OpenAI caido/sin creditos): el error propaga tal cual (el fallback vive en generation.service)", async () => {
    const { deps, imageEditor } = makeDeps();
    imageEditor.mockRejectedValue(new Error("GPT Image respondio 429: quota"));

    await expect(generateAiCreative(brand, directorInput, "https://img.example/x.jpg", "ig_feed", deps)).rejects.toThrow(/429/);
  });

  it("story: usa el tamano GPT vertical y produce 1080x1920", async () => {
    const { deps, imageEditor } = makeDeps({ scores: [90] });
    imageEditor.mockImplementation(async (input: { size: string }) => {
      expect(input.size).toBe("1024x1536");
      return { buffer: await syntheticJpeg(1024, 1536), model: "gpt-image-1", sizeUsed: input.size };
    });

    const result = await generateAiCreative(brand, { ...directorInput, format: "story" }, "https://img.example/x.jpg", "ig_story", deps);

    expect(result.width).toBe(1080);
    expect(result.height).toBe(1920);
  });

  it("logo que no descarga: sigue sin logo (logoApplied false) sin abortar", async () => {
    const withLogo: BrandProfile = { ...brand, logoUrl: "https://cdn.example/logo.png" };
    const { deps } = makeDeps({ scores: [80] });
    // fetchFn: primera llamada (foto) ok, segunda (logo) falla
    let calls = 0;
    (deps.fetchFn as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      calls++;
      if (calls === 2) return new Response("not found", { status: 404 });
      const img = await syntheticJpeg(2000, 1500);
      return new Response(new Uint8Array(img), { status: 200 });
    });

    const result = await generateAiCreative(withLogo, directorInput, "https://img.example/x.jpg", "ig_feed", deps);

    expect(result.approved).toBe(true);
    expect(result.logoApplied).toBe(false);
  });

  it("userNotes: las instrucciones del humano viajan al prompt de GPT desde la ronda 1", async () => {
    const { deps, imageEditor } = makeDeps({ scores: [88] });

    await generateAiCreative(
      brand,
      directorInput,
      "https://img.example/x.jpg",
      "ig_feed",
      deps,
      "Quita el overlay oscuro y agranda el precio"
    );

    const firstPrompt = imageEditor.mock.calls[0]![0].prompt as string;
    expect(firstPrompt).toContain("ART DIRECTOR NOTES");
    expect(firstPrompt).toContain("Quita el overlay oscuro y agranda el precio");
  });

  it("userNotes + correccion del critico coexisten en la ronda 2", async () => {
    const { deps, imageEditor } = makeDeps({ scores: [60, 85] });

    await generateAiCreative(brand, directorInput, "https://img.example/x.jpg", "ig_feed", deps, "Usa un tono mas calido");

    const secondPrompt = imageEditor.mock.calls[1]![0].prompt as string;
    expect(secondPrompt).toContain("ART DIRECTOR NOTES");
    expect(secondPrompt).toContain("Usa un tono mas calido");
    expect(secondPrompt).toContain("MANDATORY CORRECTIONS");
    expect(secondPrompt).toContain("agranda el precio");
  });
});

describe("composeRoundPrompt", () => {
  it("sin notas ni correcciones devuelve el prompt maestro tal cual", () => {
    expect(composeRoundPrompt("MASTER", undefined, [])).toBe("MASTER");
    expect(composeRoundPrompt("MASTER", "   ", [])).toBe("MASTER"); // notas en blanco se ignoran
  });

  it("incluye notas del humano y correcciones del critico como bloques separados", () => {
    const out = composeRoundPrompt("MASTER", "menos texto", ["agranda el precio", "sube el contraste"]);
    expect(out).toContain("MASTER");
    expect(out).toContain("ART DIRECTOR NOTES");
    expect(out).toContain("menos texto");
    expect(out).toContain("MANDATORY CORRECTIONS");
    expect(out).toContain("- agranda el precio");
    expect(out.indexOf("ART DIRECTOR NOTES")).toBeLessThan(out.indexOf("MANDATORY CORRECTIONS"));
  });
});
