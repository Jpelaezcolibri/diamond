import { describe, expect, it } from "vitest";
import { buildCreativeBaseData, buildPropertyCopyInput } from "../../src/services/generation.service.js";
import type { PropertyRow } from "../../src/repositories/properties.repo.js";

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
