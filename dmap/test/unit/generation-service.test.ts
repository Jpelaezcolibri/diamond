import { describe, expect, it, vi } from "vitest";
import {
  actorUserId,
  buildCreativeBaseData,
  buildPropertyCopyInput,
  hasRegenerationInput,
  produceAsset,
  produceCarouselSlides,
  regenerateCreativeForPublication
} from "../../src/services/generation.service.js";
import type { PropertyRow } from "../../src/repositories/properties.repo.js";
import type { BrandProfile } from "../../src/creatives/brand.js";
import type { CopywriterOutput } from "../../src/ai/copywriter.js";

const property: PropertyRow = {
  id: "prop-1",
  org_id: "org-1",
  ref: "AP001",
  titulo: "Apartamento en Sabaneta",
  tipo: "Apartamento",
  operacion: "Venta",
  precio: "$460.000.000",
  area: "65m2",
  habitaciones: 2,
  banos: 2,
  garaje: 1,
  estrato: 4,
  administracion: "$290.000",
  zona: "El Carmelo",
  ciudad: "Sabaneta",
  descripcion: "Muy iluminado",
  caracteristicas: "Porteria 24 horas, gimnasio, piscina",
  link: "https://info.wasi.co/apartamento/9755676",
  disponible: true,
  images: ["https://image.wasi.co/a", "https://image.wasi.co/b"],
  created_at: "2026-07-01T00:00:00Z"
};

describe("buildPropertyCopyInput", () => {
  it("mapea los campos de properties al insumo del copywriter", () => {
    const input = buildPropertyCopyInput(property);
    expect(input).toEqual({
      ref: "AP001",
      titulo: "Apartamento en Sabaneta",
      operacion: "Venta",
      precio: "$460.000.000",
      area: "65m2",
      habitaciones: 2,
      banos: 2,
      zona: "El Carmelo",
      ciudad: "Sabaneta",
      descripcion: "Muy iluminado",
      caracteristicas: "Porteria 24 horas, gimnasio, piscina"
    });
  });
});

describe("buildCreativeBaseData", () => {
  it("usa el titulo comercial generado por la IA, no el titulo original de Wasi", () => {
    const data = buildCreativeBaseData(property, "Hermoso apartamento con vista panoramica");
    expect(data.titulo).toBe("Hermoso apartamento con vista panoramica");
    expect(data.precio).toBe("$460.000.000");
    expect(data.operacion).toBe("Venta");
    expect(data.zona).toBe("El Carmelo");
    expect(data.ciudad).toBe("Sabaneta");
    expect(data.ref).toBe("AP001");
  });
});

describe("actorUserId", () => {
  it("extrae el uuid de un actor 'user:<uuid>' — publications.created_by es un uuid real, no el string con prefijo", () => {
    expect(actorUserId("user:550d9c60-dba9-4250-b695-481b85297aaf")).toBe("550d9c60-dba9-4250-b695-481b85297aaf");
  });

  it("devuelve null para actores 'system:*' (no hay usuario que referenciar)", () => {
    expect(actorUserId("system:api")).toBeNull();
    expect(actorUserId("system:generation.service")).toBeNull();
  });
});

describe("produceAsset (seleccion de motor + fallback)", () => {
  const brand: BrandProfile = {
    id: null,
    name: "Diamond",
    logoUrl: null,
    colors: { primary: "#0b1526", accent: "#c9a24b", text: "#ffffff" },
    fonts: { heading: "Playfair Display", body: "Inter" },
    layoutStyle: "premium_strip"
  };

  const copy: CopywriterOutput = {
    copy_facebook: "fb",
    copy_instagram: "ig",
    titulo_comercial: "Apartamento con vista en Sabaneta",
    descripcion_comercial: "desc",
    meta_title: "meta",
    meta_description: "meta desc",
    hashtags: ["#Sabaneta"],
    cta: "Agenda tu visita",
    alt_text_cover: "Fachada del edificio"
  };

  const aiResult = {
    buffer: Buffer.from("jpeg-ia"),
    width: 1080,
    height: 1080,
    format: "jpeg" as const,
    approved: true,
    finalScore: 88,
    rounds: [{ round: 1, score: 88, veredicto: "aprobado" as const, problemas: [], instrucciones_de_mejora: [] }],
    masterPrompt: "M".repeat(300),
    headline: "Vive Sabaneta",
    rationale: "editorial",
    promptVersion: "creative-director.v1",
    tokensIn: 100,
    tokensOut: 200,
    logoApplied: false
  };

  const designerResult = {
    buffer: Buffer.from("jpeg-designer"),
    width: 1080,
    height: 1080,
    format: "jpeg" as const,
    approved: true,
    finalScore: 90,
    rounds: [{ round: 1, score: 90, veredicto: "aprobado" as const, problemas: [], instrucciones_de_mejora: [] }],
    masterPrompt: "foto real sin retocar",
    headline: "Vive Sabaneta",
    rationale: "editorial",
    promptVersion: "creative-director.v1",
    tokensIn: 50,
    tokensOut: 80,
    logoApplied: true,
    photoEnhanced: false,
    designSpec: { headline: "Vive Sabaneta", rationale: "editorial", photo_prompt: "foto real sin retocar" }
  };

  const templateAsset = {
    publication_id: "pub-1",
    role: "cover" as const,
    position: 0,
    source_image_url: "https://img/x.jpg",
    storage_path: "org/pub/cover-0.jpg",
    public_url: "https://cdn/cover.jpg",
    width: 1080,
    height: 1080,
    format: "jpeg",
    alt_text: "Fachada del edificio",
    selected_by: "ai" as const
  };

  function makeDeps() {
    return {
      aiCreative: vi.fn().mockResolvedValue(aiResult),
      designerCreative: vi.fn().mockResolvedValue(designerResult),
      renderTemplate: vi.fn().mockResolvedValue(templateAsset),
      upload: vi.fn().mockResolvedValue({ storagePath: "org/pub/cover-0.jpg", publicUrl: "https://cdn/cover-ia.jpg" }),
      recordGeneration: vi.fn().mockResolvedValue(undefined)
    };
  }

  it("engine 'template': el motor IA nunca se invoca", async () => {
    const deps = makeDeps();
    const result = await produceAsset("template", brand, property, copy, "lujo", "https://img/x.jpg", "ig_feed", "org-1", "pub-1", "cover", deps);

    expect(deps.aiCreative).not.toHaveBeenCalled();
    expect(deps.renderTemplate).toHaveBeenCalledTimes(1);
    expect(result.meta).toEqual({ engine: "template" });
  });

  it("engine 'ai' exitoso: sube el buffer IA, registra image_generation con rondas/score y meta approved", async () => {
    const deps = makeDeps();
    const result = await produceAsset("ai", brand, property, copy, "lujo", "https://img/x.jpg", "ig_feed", "org-1", "pub-1", "cover", deps);

    expect(deps.aiCreative).toHaveBeenCalledTimes(1);
    expect(deps.renderTemplate).not.toHaveBeenCalled();
    expect(deps.upload).toHaveBeenCalledWith("org-1", "pub-1", "cover", 0, aiResult.buffer);

    const recorded = deps.recordGeneration.mock.calls[0]![0];
    expect(recorded.kind).toBe("image_generation");
    expect(recorded.output.finalScore).toBe(88);
    expect(recorded.output.roundsUsed).toBe(1);
    expect(recorded.output.estimatedCostUsd).toBeGreaterThan(0);

    expect(result.meta.engine).toBe("ai");
    expect(result.meta.approved).toBe(true);
    expect(result.asset.public_url).toBe("https://cdn/cover-ia.jpg");
  });

  it("engine 'ai' que lanza (OpenAI caido): fallback POR ASSET a plantilla con la razon en meta", async () => {
    const deps = makeDeps();
    deps.aiCreative.mockRejectedValue(new Error("GPT Image respondio 429: quota"));

    const result = await produceAsset("ai", brand, property, copy, "lujo", "https://img/x.jpg", "ig_feed", "org-1", "pub-1", "cover", deps);

    expect(deps.renderTemplate).toHaveBeenCalledTimes(1);
    expect(result.meta.engine).toBe("template_fallback");
    expect(result.meta.reason).toMatch(/429/);
    expect(result.asset).toBe(templateAsset);
  });

  it("story usa formato 'story' hacia el director y needsReview queda derivable de approved:false", async () => {
    const deps = makeDeps();
    deps.aiCreative.mockResolvedValue({ ...aiResult, approved: false, finalScore: 55 });

    const result = await produceAsset("ai", brand, property, copy, "lujo", "https://img/x.jpg", "ig_story", "org-1", "pub-1", "story", deps);

    const directorInput = deps.aiCreative.mock.calls[0]![1];
    expect(directorInput.format).toBe("story");
    expect(result.meta.approved).toBe(false);
  });

  it("engine 'designer' exitoso: sube el buffer, costo $0 (sin Gemini), nunca llama al motor IA de OpenAI", async () => {
    const deps = makeDeps();
    const result = await produceAsset("designer", brand, property, copy, "lujo", "https://img/x.jpg", "ig_feed", "org-1", "pub-1", "cover", deps);

    expect(deps.aiCreative).not.toHaveBeenCalled();
    expect(deps.designerCreative).toHaveBeenCalledTimes(1);
    expect(deps.designerCreative.mock.calls[0]![4]).toBe("designer");
    expect(deps.renderTemplate).not.toHaveBeenCalled();
    expect(deps.upload).toHaveBeenCalledWith("org-1", "pub-1", "cover", 0, designerResult.buffer);

    const recorded = deps.recordGeneration.mock.calls[0]![0];
    expect(recorded.kind).toBe("image_generation");
    expect(recorded.output.estimatedCostUsd).toBe(0);
    expect(recorded.model).toBe("claude");

    expect(result.meta.engine).toBe("designer");
    expect(result.meta.approved).toBe(true);
    expect(result.asset.public_url).toBe("https://cdn/cover-ia.jpg");
  });

  it("engine 'hybrid' con foto mejorada por Gemini: registra el costo de Gemini, no $0", async () => {
    const deps = makeDeps();
    deps.designerCreative.mockResolvedValue({ ...designerResult, photoEnhanced: true });

    const result = await produceAsset("hybrid", brand, property, copy, "lujo", "https://img/x.jpg", "ig_feed", "org-1", "pub-1", "cover", deps);

    expect(deps.designerCreative.mock.calls[0]![4]).toBe("hybrid");
    const recorded = deps.recordGeneration.mock.calls[0]![0];
    expect(recorded.output.estimatedCostUsd).toBeGreaterThan(0);
    expect(recorded.model).toBe("claude+gemini");
    expect(result.meta.engine).toBe("hybrid");
  });

  it("engine 'designer' que lanza: fallback POR ASSET a plantilla con la razon en meta", async () => {
    const deps = makeDeps();
    deps.designerCreative.mockRejectedValue(new Error("Satori no pudo renderizar la tipografia"));

    const result = await produceAsset("designer", brand, property, copy, "lujo", "https://img/x.jpg", "ig_feed", "org-1", "pub-1", "cover", deps);

    expect(deps.renderTemplate).toHaveBeenCalledTimes(1);
    expect(result.meta.engine).toBe("template_fallback");
    expect(result.meta.reason).toMatch(/Satori/);
    expect(result.asset).toBe(templateAsset);
  });
});

describe("produceCarouselSlides", () => {
  const okResponse = () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }) as unknown as Response;

  const errResponse = (status: number) => ({ ok: false, status, arrayBuffer: async () => new ArrayBuffer(0) }) as unknown as Response;

  function makeDeps() {
    return {
      fetchFn: vi.fn<typeof fetch>(async () => okResponse()),
      prepare: vi.fn(async () => ({ buffer: Buffer.from("jpg"), width: 1080, height: 1080, format: "jpeg" as const })),
      upload: vi.fn(async (_org: string, pub: string, role: string, position: number) => ({
        storagePath: `org-1/${pub}/${role}-${position}.jpg`,
        publicUrl: `https://storage.example.com/org-1/${pub}/${role}-${position}.jpg`
      })),
      // Sin esperas reales del backoff en los tests.
      sleep: async () => {}
    };
  }

  it("genera un slide por foto, con position desde 1 (0 es el cover creative)", async () => {
    const deps = makeDeps();
    const slides = await produceCarouselSlides(
      "org-1",
      "pub-1",
      ["https://image.wasi.co/b", "https://image.wasi.co/c"],
      "Foto de la propiedad",
      deps
    );
    expect(slides).toHaveLength(2);
    expect(slides.map((s) => s.position)).toEqual([1, 2]);
    expect(slides.every((s) => s.role === "carousel")).toBe(true);
    expect(slides[0]!.public_url).toContain("carousel-1.jpg");
    expect(slides[1]!.source_image_url).toBe("https://image.wasi.co/c");
  });

  it("una foto que falla en TODOS los intentos se omite sin tumbar los demas slides (conserva su position)", async () => {
    const deps = makeDeps();
    // Falla siempre para la foto "rota" (agota los reintentos); el resto ok.
    deps.fetchFn.mockImplementation(async (input: Parameters<typeof fetch>[0]) =>
      String(input).includes("rota") ? errResponse(404) : okResponse()
    );
    const slides = await produceCarouselSlides(
      "org-1",
      "pub-1",
      ["https://image.wasi.co/rota", "https://image.wasi.co/c"],
      "Foto",
      deps
    );
    expect(slides).toHaveLength(1);
    expect(slides[0]!.position).toBe(2);
    expect(slides[0]!.source_image_url).toBe("https://image.wasi.co/c");
  });

  it("un fallo transitorio de Wasi se reintenta y el slide se recupera (no se pierde)", async () => {
    const deps = makeDeps();
    // Primer intento de la foto falla (5xx), el reintento entrega la imagen.
    deps.fetchFn
      .mockImplementationOnce(async () => errResponse(503))
      .mockImplementation(async () => okResponse());
    const slides = await produceCarouselSlides("org-1", "pub-1", ["https://image.wasi.co/flaky"], "Foto", deps);
    expect(slides).toHaveLength(1);
    expect(slides[0]!.position).toBe(1);
    expect(deps.fetchFn.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("sin fotos extra devuelve vacio sin llamar red ni storage", async () => {
    const deps = makeDeps();
    const slides = await produceCarouselSlides("org-1", "pub-1", [], "Foto", deps);
    expect(slides).toEqual([]);
    expect(deps.fetchFn).not.toHaveBeenCalled();
    expect(deps.upload).not.toHaveBeenCalled();
  });
});

describe("hasRegenerationInput (guard puro de regenerateCreativeForPublication)", () => {
  it("false si notas, instrucciones del critico y foto vienen todas vacias/blancas", () => {
    expect(hasRegenerationInput("", [], undefined)).toBe(false);
    expect(hasRegenerationInput("   ", ["  ", ""], "   ")).toBe(false);
  });

  it("true con notas solas, instrucciones del critico solas, o una foto elegida a mano sola", () => {
    expect(hasRegenerationInput("quita el overlay oscuro", [], undefined)).toBe(true);
    expect(hasRegenerationInput("", ["agranda el precio"], undefined)).toBe(true);
    expect(hasRegenerationInput("", [], "https://img.wasi.co/otra-foto.jpg")).toBe(true);
  });
});

describe("regenerateCreativeForPublication (guards)", () => {
  // El resto del flujo (carga de pub/property/brand/assets + reemplazo de
  // imagen) toca Supabase y se valida E2E, igual que generateDraftForProperty.
  // El guard de notas vacias corre ANTES de cualquier IO, asi que se testea puro.
  it("rechaza notas vacias sin instrucciones del critico ni foto elegida, sin tocar red", async () => {
    await expect(regenerateCreativeForPublication("pub-1", "cover", "   ", "user:x")).rejects.toThrow(/notas/i);
    // instrucciones en blanco tampoco cuentan
    await expect(regenerateCreativeForPublication("pub-1", "cover", "", "user:x", {}, ["  ", ""])).rejects.toThrow(/notas/i);
  });
});
