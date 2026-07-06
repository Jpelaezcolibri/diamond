import { describe, expect, it, vi } from "vitest";
import { copywriterBriefFromContext, directorBriefFromContext } from "../../src/cognitive/application/briefs.js";
import { generateCopy } from "../../src/ai/copywriter.js";
import { buildCopyPrompt } from "../../src/ai/prompts/copywriter.v1.js";
import { buildCreativeDirectorPrompt } from "../../src/ai/prompts/creative-director.v2.js";
import { buildCriticPrompt } from "../../src/ai/prompts/creative-critic.v1.js";
import { propertyContextFixture, propertyFixture } from "../fixtures/property-context.js";

const property = {
  ref: propertyFixture.ref,
  titulo: propertyFixture.titulo,
  operacion: propertyFixture.operacion,
  precio: propertyFixture.precio,
  area: propertyFixture.area,
  habitaciones: propertyFixture.habitaciones,
  banos: propertyFixture.banos,
  zona: propertyFixture.zona,
  ciudad: propertyFixture.ciudad,
  descripcion: propertyFixture.descripcion
};

const validCopy = {
  copy_facebook: "Texto largo.",
  copy_instagram: "Texto corto.",
  titulo_comercial: "Titulo",
  descripcion_comercial: "Descripcion",
  meta_title: "Meta title",
  meta_description: "Meta description",
  hashtags: ["#Sabaneta"],
  cta: "Escribenos",
  alt_text_cover: "Fachada"
};

describe("briefs del Property Context", () => {
  it("el brief del copywriter lleva persona, emocion, beneficios anclados y objeciones", () => {
    const brief = copywriterBriefFromContext(propertyContextFixture);
    expect(brief).toContain("Familia en consolidación");
    expect(brief).toContain("seguridad");
    expect(brief).toContain("Portería 24h");
    expect(brief).toContain("La administración parece alta");
  });

  it("el brief del director lleva la direccion creativa, estilo visual y mood", () => {
    const brief = directorBriefFromContext(propertyContextFixture);
    expect(brief).toContain("DIRECCION COGNITIVA");
    expect(brief).toContain("Editorial claro y luminoso");
    expect(brief).toContain("Mañana soleada");
  });
});

describe("integracion del brief en los prompts", () => {
  it("buildCopyPrompt incluye el brief y la regla de prioridad solo cuando existe", () => {
    const sin = buildCopyPrompt(property, "familiar", { name: "Diamond" });
    expect(sin).not.toContain("CONTEXTO ESTRATEGICO");

    const brief = copywriterBriefFromContext(propertyContextFixture);
    const con = buildCopyPrompt(property, "familiar", { name: "Diamond" }, brief);
    expect(con).toContain("CONTEXTO ESTRATEGICO");
    expect(con).toContain("manda el contexto estrategico");
  });

  it("el director v2 inserta el brief sin perder la regla anti-oscuridad", () => {
    const brief = directorBriefFromContext(propertyContextFixture);
    const prompt = buildCreativeDirectorPrompt({
      property,
      styleVariant: "familiar",
      tituloComercial: "Titulo",
      cta: "Escribenos",
      format: "feed",
      brand: { name: "Diamond" },
      cognitiveBrief: brief
    });
    expect(prompt).toContain("DIRECCION COGNITIVA");
    expect(prompt).toContain("REGLA ANTI-OSCURIDAD");
    expect(prompt).toContain("innegociables");
  });

  it("el critico agrega el criterio 8 de coherencia cognitiva solo con brief", () => {
    const base = { property, headline: "Titular", format: "feed" as const };
    expect(buildCriticPrompt(base)).not.toContain("COHERENCIA COGNITIVA");
    expect(buildCriticPrompt({ ...base, cognitiveBrief: "Direccion X" })).toContain("COHERENCIA COGNITIVA");
  });

  it("generateCopy marca la corrida con '+dce' solo cuando uso contexto", async () => {
    const caller = vi.fn().mockResolvedValue({ text: JSON.stringify(validCopy), tokensIn: 1, tokensOut: 1 });

    const legacy = await generateCopy(property, "familiar", { name: "Diamond" }, caller);
    expect(legacy.promptVersion).toBe("copywriter.v1");

    const conContexto = await generateCopy(property, "familiar", { name: "Diamond" }, caller, "brief");
    expect(conContexto.promptVersion).toBe("copywriter.v1+dce");
  });
});
