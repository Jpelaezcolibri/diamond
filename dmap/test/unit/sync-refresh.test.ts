import { describe, expect, it } from "vitest";
import { camposQueSeRefrescan } from "../../src/sync/refresh.js";
import type { CanonicalProperty } from "../../src/sync/wasi-source.js";

const base = {
  ref: "9495363",
  titulo: "Venta casa campestre en Envigado",
  tipo: "Casa Campestre",
  operacion: "Venta",
  precio: "$1.500.000.000",
  descripcion: "x",
  area: "350m2",
  habitaciones: 4,
  banos: 3,
  zona: "La Catedral",
  ciudad: "Envigado",
  link: "http://diamondinmobiliaria.com/casa-campestre-venta-la-catedral-envigado/9495363",
  garaje: 2,
  estrato: null,
  caracteristicas: null,
  administracion: null
} as unknown as CanonicalProperty;

describe("camposQueSeRefrescan", () => {
  it("la zona que Wasi ya tiene llega a la fila (caso 9495363, 2026-10-07)", () => {
    const patch = camposQueSeRefrescan(base);
    expect(patch.zona).toBe("La Catedral");
    expect(patch.ciudad).toBe("Envigado");
    expect(patch.area).toBe("350m2");
    expect(patch.habitaciones).toBe(4);
  });

  it("lo que Wasi manda vacio no borra lo que tiene la fila", () => {
    const patch = camposQueSeRefrescan({ ...base, zona: "", area: null, estrato: null } as CanonicalProperty);
    expect(patch).not.toHaveProperty("zona");
    expect(patch).not.toHaveProperty("area");
    expect(patch).not.toHaveProperty("estrato");
  });

  it("no toca el link, el precio, el titulo ni la disponibilidad (los gobierna el diff)", () => {
    const patch = camposQueSeRefrescan(base);
    for (const campo of ["link", "precio", "titulo", "descripcion", "disponible"]) {
      expect(patch).not.toHaveProperty(campo);
    }
  });
});
