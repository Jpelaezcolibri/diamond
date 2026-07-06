import { describe, expect, it } from "vitest";
import {
  deriveCategoriaOperacion,
  deriveContext,
  deriveSegmentoPrecio,
  parsePrecio
} from "../../src/cognitive/application/derive.rules.js";
import { propertyFixture } from "../fixtures/property-context.js";

describe("parsePrecio", () => {
  it("parsea el formato colombiano de Wasi con simbolo y puntos de miles", () => {
    expect(parsePrecio("$460.000.000")).toBe(460_000_000);
    expect(parsePrecio("1.550.000")).toBe(1_550_000);
  });

  it("descarta decimales con coma (los precios inmobiliarios no usan centavos)", () => {
    expect(parsePrecio("$2.500.000,50")).toBe(2_500_000);
  });

  it("devuelve null para textos sin precio o cero", () => {
    expect(parsePrecio(null)).toBeNull();
    expect(parsePrecio("Consultar")).toBeNull();
    expect(parsePrecio("$0")).toBeNull();
  });
});

describe("deriveCategoriaOperacion", () => {
  it("clasifica venta y arriendo con variantes", () => {
    expect(deriveCategoriaOperacion("Venta")).toBe("venta");
    expect(deriveCategoriaOperacion("Arriendo")).toBe("arriendo");
    expect(deriveCategoriaOperacion("Alquiler")).toBe("arriendo");
    expect(deriveCategoriaOperacion(null)).toBe("desconocida");
  });
});

describe("deriveSegmentoPrecio", () => {
  it("segmenta ventas por los cortes COP", () => {
    expect(deriveSegmentoPrecio(200_000_000, "venta")).toBe("economico");
    expect(deriveSegmentoPrecio(460_000_000, "venta")).toBe("medio");
    expect(deriveSegmentoPrecio(850_000_000, "venta")).toBe("medio-alto");
    expect(deriveSegmentoPrecio(1_500_000_000, "venta")).toBe("alto");
    expect(deriveSegmentoPrecio(2_500_000_000, "venta")).toBe("lujo");
  });

  it("usa cortes distintos para arriendo", () => {
    expect(deriveSegmentoPrecio(1_200_000, "arriendo")).toBe("economico");
    expect(deriveSegmentoPrecio(2_500_000, "arriendo")).toBe("medio");
    expect(deriveSegmentoPrecio(12_000_000, "arriendo")).toBe("lujo");
  });

  it("es desconocido sin precio u operacion", () => {
    expect(deriveSegmentoPrecio(null, "venta")).toBe("desconocido");
    expect(deriveSegmentoPrecio(460_000_000, "desconocida")).toBe("desconocido");
  });
});

describe("deriveContext", () => {
  it("deriva el grupo completo de la propiedad fixture", () => {
    const derived = deriveContext(propertyFixture);
    expect(derived).toEqual({
      segmentoPrecio: "medio",
      categoriaOperacion: "venta",
      precioNumerico: 460_000_000,
      totalFotos: 2,
      totalCaracteristicas: 3
    });
  });

  it("no explota con una propiedad sin datos opcionales", () => {
    const derived = deriveContext({ ...propertyFixture, precio: null, operacion: null, caracteristicas: null, images: [] });
    expect(derived.segmentoPrecio).toBe("desconocido");
    expect(derived.precioNumerico).toBeNull();
    expect(derived.totalFotos).toBe(0);
    expect(derived.totalCaracteristicas).toBe(0);
  });
});
