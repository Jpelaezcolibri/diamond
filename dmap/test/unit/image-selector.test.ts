import { describe, expect, it } from "vitest";
import { rankImages, selectAssets, type ImageAnalysis } from "../../src/ai/image-selector.js";

function img(partial: Partial<ImageAnalysis> & { imageUrl: string }): ImageAnalysis {
  return {
    roomType: "otro",
    brightnessScore: 80,
    qualityScore: 80,
    isDark: false,
    duplicateGroup: null,
    ...partial
  };
}

describe("rankImages", () => {
  it("prioriza fachada > sala > cocina > balcon/vista > habitacion principal", () => {
    const analyses = [
      img({ imageUrl: "hab", roomType: "habitacion_principal" }),
      img({ imageUrl: "cocina", roomType: "cocina" }),
      img({ imageUrl: "fachada", roomType: "fachada" }),
      img({ imageUrl: "sala", roomType: "sala" }),
      img({ imageUrl: "balcon", roomType: "balcon" })
    ];
    const ranked = rankImages(analyses).map((a) => a.imageUrl);
    expect(ranked).toEqual(["fachada", "sala", "cocina", "balcon", "hab"]);
  });

  it("excluye fotos oscuras", () => {
    const analyses = [
      img({ imageUrl: "buena", roomType: "sala" }),
      img({ imageUrl: "oscura", roomType: "fachada", isDark: true })
    ];
    expect(rankImages(analyses).map((a) => a.imageUrl)).toEqual(["buena"]);
  });

  it("deduplica quedandose con la de mayor quality_score del grupo", () => {
    const analyses = [
      img({ imageUrl: "sala-mala", roomType: "sala", qualityScore: 40, duplicateGroup: "g1" }),
      img({ imageUrl: "sala-buena", roomType: "sala", qualityScore: 90, duplicateGroup: "g1" })
    ];
    const ranked = rankImages(analyses);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.imageUrl).toBe("sala-buena");
  });

  it("dentro del mismo tipo de espacio, ordena por calidad descendente", () => {
    const analyses = [
      img({ imageUrl: "sala-baja", roomType: "sala", qualityScore: 50 }),
      img({ imageUrl: "sala-alta", roomType: "sala", qualityScore: 95 })
    ];
    expect(rankImages(analyses).map((a) => a.imageUrl)).toEqual(["sala-alta", "sala-baja"]);
  });
});

describe("selectAssets", () => {
  it("devuelve null si no hay fotos utilizables", () => {
    expect(selectAssets([img({ imageUrl: "oscura", isDark: true })])).toBeNull();
  });

  it("elige portada = mejor foto y la reutiliza como thumbnail", () => {
    const analyses = [img({ imageUrl: "fachada", roomType: "fachada" }), img({ imageUrl: "sala", roomType: "sala" })];
    const assets = selectAssets(analyses)!;
    expect(assets.cover).toBe("fachada");
    expect(assets.thumbnail).toBe("fachada");
  });

  it("limita el carrusel a 7 fotos", () => {
    const analyses = Array.from({ length: 10 }, (_, i) => img({ imageUrl: `foto-${i}`, qualityScore: 100 - i }));
    const assets = selectAssets(analyses)!;
    expect(assets.carousel).toHaveLength(7);
  });

  it("elige una historia distinta de la portada cuando hay mas de una foto", () => {
    const analyses = [img({ imageUrl: "fachada", roomType: "fachada" }), img({ imageUrl: "sala", roomType: "sala" })];
    const assets = selectAssets(analyses)!;
    expect(assets.story).not.toBe(assets.cover);
  });

  it("con una sola foto, la usa para todo", () => {
    const assets = selectAssets([img({ imageUrl: "unica" })])!;
    expect(assets).toEqual({ cover: "unica", carousel: ["unica"], story: "unica", thumbnail: "unica" });
  });
});
