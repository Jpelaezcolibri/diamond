import { describe, expect, it } from "vitest";
import {
  extractImages,
  extractPropertyEntries,
  normalizeOperacionYPrecio,
  toCanonicalProperty,
  wasiApiPropertySchema
} from "../../src/sync/wasi-api.source.js";

/**
 * Fixture basado en una respuesta REAL de api.wasi.co/v1/property/search
 * (verificada 2026-07-05 contra la cuenta de produccion de Diamond/Paraiso
 * Inmobiliario — ver dmap/README.md). Sin datos sensibles: el token de la
 * API viaja como query param de la request, nunca en el cuerpo de una
 * propiedad. Los IDs y textos son reales pero publicos (son anuncios
 * publicados). Confirma que wasi-api.source.ts refleja la forma real, no
 * una suposicion — la version anterior (pre-credenciales) tenia una forma
 * completamente distinta (`{data:[...], total}` en vez de llaves numericas
 * con `total`/`status` como hermanos, `operation`/`price` en vez de
 * `for_sale`/`sale_price_label`, etc).
 */
const REAL_SEARCH_RESPONSE = {
  "0": {
    id_property: 10113016,
    id_company: 12212160,
    for_sale: "true",
    for_rent: "false",
    for_transfer: "false",
    for_temporary_rent: "false",
    title: "VENDO DUPLEX  FRENTE AL VIVA LAURELES PRECIO DE OPORTUNIDAD",
    reference: "",
    zone_label: "Laureles",
    city_label: "Medellín",
    area: "186",
    unit_area_label: "M2",
    sale_price: "820000000",
    sale_price_label: "$820.000.000",
    rent_price: "0",
    rent_price_label: "$0",
    bedrooms: "4",
    bathrooms: "3",
    garages: "1",
    stratum: "5",
    observations: "<p>*VENDO DUPLEX UBICADO DIAGONAL AL VIVA LAURELES</p>",
    link: "https://paraisoinmobiliario.inmo.co/duplex-venta-laureles-medellin/10113016",
    main_image: {
      id: 343370878,
      filename: "87331420260630055622.jpeg",
      position: 1,
      url: "https://image.wasi.co/eyJi...",
      url_big: "https://image.wasi.co/eyJi...",
      url_original: "https://images.wasi.co/inmuebles/87331420260630055622.jpeg"
    },
    galleries: [
      {
        "0": {
          id: 343370878,
          filename: "87331420260630055622.jpeg",
          position: 1,
          url_original: "https://images.wasi.co/inmuebles/87331420260630055622.jpeg"
        },
        "1": {
          id: 343370880,
          filename: "87331620260630055628.jpeg",
          position: 2,
          url_original: "https://images.wasi.co/inmuebles/87331620260630055628.jpeg"
        },
        "2": {
          id: 343370881,
          filename: "87331720260630055630.jpeg",
          position: 3,
          url_original: "https://images.wasi.co/inmuebles/87331720260630055630.jpeg"
        }
      }
    ],
    features: { internal: [], external: [] },
    user_data: { first_name: "Paraíso", last_name: "Inmobiliario" }
  },
  total: 96,
  status: "success"
};

describe("extractPropertyEntries", () => {
  it("extrae solo las entradas con llave numerica, ignora total/status", () => {
    const entries = extractPropertyEntries(REAL_SEARCH_RESPONSE);
    expect(entries).toHaveLength(1);
    expect((entries[0] as { id_property: number }).id_property).toBe(10113016);
  });

  it("devuelve vacio si la respuesta no es un objeto", () => {
    expect(extractPropertyEntries(null)).toEqual([]);
    expect(extractPropertyEntries("no-object")).toEqual([]);
  });
});

describe("wasiApiPropertySchema + toCanonicalProperty (fixture real)", () => {
  const raw = wasiApiPropertySchema.parse(REAL_SEARCH_RESPONSE["0"]);

  it("parsea la propiedad real sin lanzar (passthrough tolera campos no mapeados)", () => {
    expect(raw.id_property).toBe(10113016);
  });

  it("usa el id_property como ref cuando reference viene vacio", () => {
    const canonical = toCanonicalProperty(raw);
    expect(canonical.ref).toBe("10113016");
  });

  it("mapea for_sale=true a operacion Venta con el precio formateado", () => {
    const canonical = toCanonicalProperty(raw);
    expect(canonical.operacion).toBe("Venta");
    expect(canonical.precio).toBe("$820.000.000");
  });

  it("mapea titulo, descripcion (observations), zona, ciudad", () => {
    const canonical = toCanonicalProperty(raw);
    expect(canonical.titulo).toContain("DUPLEX");
    expect(canonical.descripcion).toContain("DUPLEX UBICADO");
    expect(canonical.zona).toBe("Laureles");
    expect(canonical.ciudad).toBe("Medellín");
  });

  it("convierte area+unidad al formato usado en properties (186m2)", () => {
    expect(toCanonicalProperty(raw).area).toBe("186m2");
  });

  it("convierte bedrooms/bathrooms de string a numero", () => {
    const canonical = toCanonicalProperty(raw);
    expect(canonical.habitaciones).toBe(4);
    expect(canonical.banos).toBe(3);
  });

  it("usa el link real de la propiedad", () => {
    expect(toCanonicalProperty(raw).link).toBe("https://paraisoinmobiliario.inmo.co/duplex-venta-laureles-medellin/10113016");
  });
});

describe("normalizeOperacionYPrecio", () => {
  it("prioriza venta si for_sale=true", () => {
    const result = normalizeOperacionYPrecio({
      id_property: 1,
      for_sale: "true",
      for_rent: "false",
      sale_price_label: "$500.000.000"
    } as never);
    expect(result).toEqual({ operacion: "Venta", precio: "$500.000.000" });
  });

  it("usa arriendo si for_rent=true y for_sale=false", () => {
    const result = normalizeOperacionYPrecio({
      id_property: 1,
      for_sale: "false",
      for_rent: "true",
      rent_price_label: "$2.000.000"
    } as never);
    expect(result).toEqual({ operacion: "Arriendo", precio: "$2.000.000" });
  });

  it("devuelve null si ninguno esta activo", () => {
    const result = normalizeOperacionYPrecio({ id_property: 1, for_sale: "false", for_rent: "false" } as never);
    expect(result).toEqual({ operacion: null, precio: null });
  });
});

describe("extractImages", () => {
  it("extrae todas las fotos de galleries[0] ordenadas por position, usando url_original", () => {
    const raw = wasiApiPropertySchema.parse(REAL_SEARCH_RESPONSE["0"]);
    const { imageKeys, imageUrls } = extractImages(raw);
    expect(imageUrls).toEqual([
      "https://images.wasi.co/inmuebles/87331420260630055622.jpeg",
      "https://images.wasi.co/inmuebles/87331620260630055628.jpeg",
      "https://images.wasi.co/inmuebles/87331720260630055630.jpeg"
    ]);
    expect(imageKeys).toEqual(["343370878", "343370880", "343370881"]);
  });

  it("cae a main_image si no hay galleries", () => {
    const raw = wasiApiPropertySchema.parse({
      id_property: 2,
      main_image: { id: 99, url_original: "https://images.wasi.co/inmuebles/solo.jpeg" }
    });
    const { imageUrls } = extractImages(raw);
    expect(imageUrls).toEqual(["https://images.wasi.co/inmuebles/solo.jpeg"]);
  });

  it("devuelve listas vacias si no hay ninguna imagen", () => {
    const raw = wasiApiPropertySchema.parse({ id_property: 3 });
    expect(extractImages(raw)).toEqual({ imageKeys: [], imageUrls: [] });
  });
});
