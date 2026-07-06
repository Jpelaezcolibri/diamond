import { describe, expect, it, vi } from "vitest";
import { actorUserId, buildCreativeBaseData, buildPropertyCopyInput, produceAsset } from "../../src/services/generation.service.js";
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
});
