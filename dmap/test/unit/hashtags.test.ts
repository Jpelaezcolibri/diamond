import { describe, expect, it } from "vitest";
import { normalizeHashtags } from "../../src/lib/hashtags.js";

describe("normalizeHashtags", () => {
  it("prefija # a los tags que vienen sin el (bug real: salian como texto plano)", () => {
    expect(normalizeHashtags(["ApartamentosMedellin", "VentaDeApartamentos"])).toEqual([
      "#ApartamentosMedellin",
      "#VentaDeApartamentos"
    ]);
  });

  it("no duplica el # cuando ya viene (incluso repetido)", () => {
    expect(normalizeHashtags(["#Sabaneta", "##Itagui"])).toEqual(["#Sabaneta", "#Itagui"]);
  });

  it("quita espacios y puntuacion interna que cortarian el hashtag", () => {
    expect(normalizeHashtags([" # Apartamentos Medellin ", "venta-de-casas", "finca.raiz"])).toEqual([
      "#ApartamentosMedellin",
      "#ventadecasas",
      "#fincaraiz"
    ]);
  });

  it("conserva tildes, enie y numeros", () => {
    expect(normalizeHashtags(["Medellín", "año2026", "El_Poblado"])).toEqual(["#Medellín", "#año2026", "#El_Poblado"]);
  });

  it("descarta vacios y deduplica sin distinguir mayusculas", () => {
    expect(normalizeHashtags(["", "  ", "#", "Sabaneta", "#sabaneta"])).toEqual(["#Sabaneta"]);
  });
});
