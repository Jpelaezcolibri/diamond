import { describe, expect, it, vi } from "vitest";
import { generateMasterPrompt } from "../../src/ai/creative-director.js";
import { buildCreativeDirectorPrompt, type CreativeDirectorInput } from "../../src/ai/prompts/creative-director.v1.js";

const input: CreativeDirectorInput = {
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
    descripcion: "Apartamento en piso 7 con balcon"
  },
  styleVariant: "lujo",
  tituloComercial: "Apartamento Exclusivo en Las Palmas",
  cta: "Agenda tu visita",
  format: "feed",
  brand: { name: "Diamond Inmobiliaria" }
};

const validOutput = {
  master_prompt: "A".repeat(300),
  headline: "Vive el lujo de Las Palmas",
  rationale: "Direccion editorial oscura para audiencia de alto poder adquisitivo."
};

describe("buildCreativeDirectorPrompt", () => {
  it("incluye las reglas duras: foto real, sin logo, max 7 palabras, paleta Diamond", () => {
    const prompt = buildCreativeDirectorPrompt(input);
    expect(prompt).toMatch(/PROHIBIDO reemplazar/);
    expect(prompt).toMatch(/NO incluya ningun logo/);
    expect(prompt).toMatch(/max 7 palabras/);
    expect(prompt).toContain("#D4AF37");
    expect(prompt).toContain("#0D1117");
    expect(prompt).toMatch(/Canva/);
  });

  it("incluye los datos reales de la propiedad y el estilo con su audiencia", () => {
    const prompt = buildCreativeDirectorPrompt(input);
    expect(prompt).toContain("8989725");
    expect(prompt).toContain("$920.000.000");
    expect(prompt).toContain("El Poblado");
    expect(prompt).toMatch(/exclusividad y estatus/); // audiencia del estilo "lujo"
  });

  it("adapta el formato: story pide 9:16 vertical", () => {
    const prompt = buildCreativeDirectorPrompt({ ...input, format: "story" });
    expect(prompt).toMatch(/9:16/);
  });
});

describe("generateMasterPrompt", () => {
  it("devuelve el output parseado en el primer intento", async () => {
    const caller = vi.fn().mockResolvedValue({ text: JSON.stringify(validOutput), tokensIn: 100, tokensOut: 400 });

    const result = await generateMasterPrompt(input, caller);

    expect(result.output.master_prompt).toBe(validOutput.master_prompt);
    expect(result.output.headline).toBe("Vive el lujo de Las Palmas");
    expect(result.promptVersion).toBe("creative-director.v1");
    expect(caller).toHaveBeenCalledTimes(1);
  });

  it("trunca un headline de mas de 7 palabras en vez de tumbar la generacion", async () => {
    const largo = { ...validOutput, headline: "Uno dos tres cuatro cinco seis siete ocho nueve" };
    const caller = vi.fn().mockResolvedValue({ text: JSON.stringify(largo), tokensIn: 1, tokensOut: 1 });

    const result = await generateMasterPrompt(input, caller);

    expect(result.output.headline).toBe("Uno dos tres cuatro cinco seis siete");
  });

  it("rechaza un master_prompt demasiado corto (schema exige detalle)", async () => {
    const corto = { ...validOutput, master_prompt: "corto" };
    const caller = vi.fn().mockResolvedValue({ text: JSON.stringify(corto), tokensIn: 1, tokensOut: 1 });

    await expect(generateMasterPrompt(input, caller)).rejects.toThrow(/no produjo un prompt valido/);
    expect(caller).toHaveBeenCalledTimes(2); // retry-una-vez
  });

  it("reintenta una vez si la primera respuesta no es JSON", async () => {
    const caller = vi
      .fn()
      .mockResolvedValueOnce({ text: "no es json", tokensIn: 1, tokensOut: 1 })
      .mockResolvedValueOnce({ text: JSON.stringify(validOutput), tokensIn: 1, tokensOut: 1 });

    const result = await generateMasterPrompt(input, caller);
    expect(result.output.rationale).toBe(validOutput.rationale);
    expect(caller).toHaveBeenCalledTimes(2);
  });
});
