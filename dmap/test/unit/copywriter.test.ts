import { describe, expect, it, vi } from "vitest";
import { generateCopy } from "../../src/ai/copywriter.js";
import type { CopywriterPropertyInput } from "../../src/ai/prompts/copywriter.v1.js";

const property: CopywriterPropertyInput = {
  ref: "AP001",
  titulo: "Apartamento en Sabaneta",
  operacion: "Venta",
  precio: "$460.000.000",
  area: "65m2",
  habitaciones: 2,
  banos: 2,
  zona: "El Carmelo",
  ciudad: "Sabaneta",
  descripcion: "Muy iluminado"
};

const brand = { name: "Diamond" };

const validOutput = {
  copy_facebook: "Texto largo para Facebook.",
  copy_instagram: "Texto corto para IG.",
  titulo_comercial: "Hermoso apartamento en Sabaneta",
  descripcion_comercial: "Descripcion comercial completa.",
  meta_title: "Apartamento en venta Sabaneta",
  meta_description: "Meta description util para SEO.",
  hashtags: ["#Sabaneta", "#ApartamentoEnVenta"],
  cta: "Escribenos por WhatsApp",
  alt_text_cover: "Fachada de edificio residencial moderno"
};

describe("generateCopy", () => {
  it("devuelve el output parseado en el primer intento si el JSON es valido", async () => {
    const caller = vi.fn().mockResolvedValue({ text: JSON.stringify(validOutput), tokensIn: 100, tokensOut: 200 });

    const result = await generateCopy(property, "lujo", brand, caller);

    expect(result.output).toEqual(validOutput);
    expect(result.tokensIn).toBe(100);
    expect(result.tokensOut).toBe(200);
    expect(caller).toHaveBeenCalledTimes(1);
  });

  it("reintenta una vez si la primera respuesta no es JSON valido", async () => {
    const caller = vi
      .fn()
      .mockResolvedValueOnce({ text: "esto no es json", tokensIn: 10, tokensOut: 5 })
      .mockResolvedValueOnce({ text: JSON.stringify(validOutput), tokensIn: 100, tokensOut: 200 });

    const result = await generateCopy(property, "familiar", brand, caller);

    expect(result.output).toEqual(validOutput);
    expect(caller).toHaveBeenCalledTimes(2);
  });

  it("lanza FatalError si ambos intentos fallan", async () => {
    const caller = vi.fn().mockResolvedValue({ text: "sigue sin ser json", tokensIn: 10, tokensOut: 5 });

    await expect(generateCopy(property, "premium", brand, caller)).rejects.toThrow(/No se pudo generar copy valido/);
    expect(caller).toHaveBeenCalledTimes(2);
  });

  it("rechaza un JSON que no cumple el schema (ej. hashtags vacios)", async () => {
    const caller = vi
      .fn()
      .mockResolvedValue({ text: JSON.stringify({ ...validOutput, hashtags: [] }), tokensIn: 10, tokensOut: 5 });

    await expect(generateCopy(property, "corporativo", brand, caller)).rejects.toThrow();
    expect(caller).toHaveBeenCalledTimes(2);
  });

  it("recorta meta_description/meta_title si el modelo se pasa del limite en vez de fallar (bug real 2026-07-06)", async () => {
    const largaDescripcion = "Esta es una meta description absurdamente larga que un LLM puede generar sin darse cuenta ".repeat(3);
    const largoTitulo = "Un titulo SEO demasiado largo que definitivamente supera los setenta caracteres permitidos por el schema";
    const caller = vi.fn().mockResolvedValue({
      text: JSON.stringify({ ...validOutput, meta_title: largoTitulo, meta_description: largaDescripcion }),
      tokensIn: 10,
      tokensOut: 5
    });

    const result = await generateCopy(property, "lujo", brand, caller);

    expect(result.output.meta_title.length).toBeLessThanOrEqual(70);
    expect(result.output.meta_description.length).toBeLessThanOrEqual(160);
    expect(caller).toHaveBeenCalledTimes(1);
  });

  it("el prompt incluye la referencia de la propiedad y el estilo pedido", async () => {
    let capturedPrompt = "";
    const caller = vi.fn().mockImplementation(async (prompt: string) => {
      capturedPrompt = prompt;
      return { text: JSON.stringify(validOutput), tokensIn: 1, tokensOut: 1 };
    });

    await generateCopy(property, "inversionista", brand, caller);

    expect(capturedPrompt).toContain("AP001");
    expect(capturedPrompt).toContain("inversionista");
    expect(capturedPrompt).toMatch(/plantillas repetitivas/i);
  });
});
