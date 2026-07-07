import { describe, expect, it, vi } from "vitest";
import { critiqueCreative } from "../../src/ai/creative-critic.js";
import { buildCriticPrompt, type CreativeCriticContext } from "../../src/ai/prompts/creative-critic.v1.js";

const ctx: CreativeCriticContext = {
  property: {
    ref: "8989725",
    titulo: "Venta de Apartamento en Palmas Medellin",
    operacion: "Venta",
    precio: "$920.000.000",
    area: "92m2",
    habitaciones: 2,
    banos: 3,
    zona: "El Poblado",
    ciudad: "Medellín",
    descripcion: null
  },
  headline: "Vive el lujo de Las Palmas",
  format: "feed",
  engine: "ai"
};

const aprobado = {
  score: 88,
  veredicto: "aprobado",
  problemas: [],
  instrucciones_de_mejora: []
};

describe("buildCriticPrompt", () => {
  it("engine 'ai': incluye la rubrica de texto letra por letra (GPT Image puede deformarlo), datos reales, marca", () => {
    const prompt = buildCriticPrompt(ctx);
    expect(prompt).toMatch(/LETRA POR LETRA/);
    expect(prompt).toContain("$920.000.000");
    expect(prompt).toContain("Vive el lujo de Las Palmas");
    expect(prompt).toContain("#D4AF37");
    expect(prompt).toMatch(/75/); // umbral
  });

  it("engine 'designer'/'hybrid': NO pide revisar ortografia/tildes (satori nunca deforma texto) y guia el encuadre hacia photo_focus", () => {
    for (const engine of ["designer", "hybrid"] as const) {
      const prompt = buildCriticPrompt({ ...ctx, engine });
      expect(prompt).not.toMatch(/LETRA POR LETRA/);
      expect(prompt).not.toMatch(/tildes\/enie corruptas/);
      expect(prompt).toMatch(/photo_focus/);
      expect(prompt).toMatch(/nunca pidas ["“]otra foto["”]|no puede elegir ni retocar la foto/);
    }
  });

  it("toda instruccion de mejora debe ser algo que el disenador pueda cambiar en su spec (REGLA DE ORO)", () => {
    const prompt = buildCriticPrompt(ctx);
    expect(prompt).toMatch(/REGLA DE ORO/);
    expect(prompt).toMatch(/photo_focus/);
  });
});

describe("critiqueCreative", () => {
  it("parsea la evaluacion valida y acumula tokens", async () => {
    const caller = vi.fn().mockResolvedValue({ text: JSON.stringify(aprobado), tokensIn: 500, tokensOut: 80 });

    const result = await critiqueCreative("base64img", ctx, caller);

    expect(result.output.score).toBe(88);
    expect(result.output.veredicto).toBe("aprobado");
    expect(caller).toHaveBeenCalledTimes(1);
    expect(caller).toHaveBeenCalledWith(expect.stringContaining("Critico Creativo"), "base64img");
  });

  it("rechaza score fuera de rango via zod y reintenta", async () => {
    const invalido = { ...aprobado, score: 140 };
    const caller = vi
      .fn()
      .mockResolvedValueOnce({ text: JSON.stringify(invalido), tokensIn: 10, tokensOut: 5 })
      .mockResolvedValueOnce({ text: JSON.stringify(aprobado), tokensIn: 10, tokensOut: 5 });

    const result = await critiqueCreative("img", ctx, caller);
    expect(result.output.score).toBe(88);
    expect(result.tokensIn).toBe(20); // acumulados de ambos intentos
  });

  it("JSON ilegible 2 veces -> degrada a score 0 rechazado SIN lanzar (no pierde la imagen ya pagada)", async () => {
    const caller = vi.fn().mockResolvedValue({ text: "esto nunca sera json", tokensIn: 10, tokensOut: 5 });

    const result = await critiqueCreative("img", ctx, caller);

    expect(result.output.score).toBe(0);
    expect(result.output.veredicto).toBe("rechazado");
    expect(result.output.problemas[0]).toMatch(/no produjo una evaluacion legible/);
    expect(caller).toHaveBeenCalledTimes(2);
  });
});
