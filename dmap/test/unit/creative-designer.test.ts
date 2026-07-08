import { describe, expect, it, vi } from "vitest";
import { generateDesignSpec, reconcileSpecsWithRealData } from "../../src/ai/creative-designer.js";
import type { CreativeDesignerInput } from "../../src/ai/prompts/creative-designer.v1.js";

describe("reconcileSpecsWithRealData", () => {
  const property = { area: "2.950 m2", habitaciones: 3, banos: 4 };

  it("corrige un area mal transcrita preservando el formato/label elegido", () => {
    const fixed = reconcileSpecsWithRealData(["650 m²"], property);
    expect(fixed).toEqual(["2.950 m²"]);
  });

  it("preserva un label adicional alrededor del numero (ej. 'terreno')", () => {
    const fixed = reconcileSpecsWithRealData(["650 m² terreno"], property);
    expect(fixed).toEqual(["2.950 m² terreno"]);
  });

  it("corrige habitaciones y banos mal transcritos", () => {
    const fixed = reconcileSpecsWithRealData(["5 hab", "2 baños"], property);
    expect(fixed).toEqual(["3 hab", "4 baños"]);
  });

  it("no toca specs que ya coinciden con el dato real", () => {
    const fixed = reconcileSpecsWithRealData(["2.950 m²", "3 hab", "4 baños"], property);
    expect(fixed).toEqual(["2.950 m²", "3 hab", "4 baños"]);
  });

  it("NO toca un area 'construida' — property.area es el area de lote/terreno, no hay ground truth para el area construida (hallazgo real: Las Palmas 650m2 construidos en lote de 2.950m2, dos datos reales distintos)", () => {
    const fixed = reconcileSpecsWithRealData(["650 m² construidos"], property);
    expect(fixed).toEqual(["650 m² construidos"]);
  });

  it("SI reconcilia un area de lote/terreno explicita", () => {
    const fixed = reconcileSpecsWithRealData(["500 m² de lote"], property);
    expect(fixed).toEqual(["2.950 m² de lote"]);
  });

  it("no toca specs sin numero comparable (ej. un highlight de texto libre)", () => {
    const fixed = reconcileSpecsWithRealData(["Casa de mayordomo"], property);
    expect(fixed).toEqual(["Casa de mayordomo"]);
  });

  it("si falta el dato real (null), deja el spec como vino", () => {
    const fixed = reconcileSpecsWithRealData(["650 m²"], { area: null, habitaciones: null, banos: null });
    expect(fixed).toEqual(["650 m²"]);
  });
});

describe("generateDesignSpec", () => {
  const baseInput: CreativeDesignerInput = {
    property: {
      ref: "10029496",
      titulo: "Casa en Llanogrande",
      operacion: "Venta",
      precio: "$4.000.000.000",
      area: "2.950 m2",
      habitaciones: 3,
      banos: 4,
      zona: "Llano Grande",
      ciudad: "Medellín",
      descripcion: null
    },
    styleVariant: "lujo",
    tituloComercial: "Casa Campestre 2.950m² en Llanogrande",
    cta: "Agenda tu visita",
    format: "feed",
    brand: { name: "Diamond" }
  };

  const validSpecOutput = {
    headline: "Amplitud que define el privilegio",
    price_text: "$4.000.000.000",
    specs: ["650 m²", "3 hab", "4 baños"], // area mal transcrita a proposito
    location_text: "Llano Grande, Medellín",
    cta_text: "Agenda tu visita privada",
    panel: "light",
    text_zone: "bottom_strip",
    photo_focus: "center",
    photo_prompt: "mejora la luz natural, colores calidos",
    rationale: "test"
  };

  it("reconcilia el area de la respuesta del modelo contra el dato real antes de devolver el spec", async () => {
    const caller = vi.fn().mockResolvedValue({ text: JSON.stringify(validSpecOutput), tokensIn: 100, tokensOut: 50 });

    const result = await generateDesignSpec(baseInput, caller);

    expect(result.output.specs).toEqual(["2.950 m²", "3 hab", "4 baños"]);
  });
});
