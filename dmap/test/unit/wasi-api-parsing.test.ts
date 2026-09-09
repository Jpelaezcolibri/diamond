import { describe, expect, it } from "vitest";
import {
  extractImages,
  extractPropertyEntries,
  normalizeArea,
  normalizeOperacionYPrecio,
  parseSearchPage,
  verificarDescartes,
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
    // Forma REAL verificada en produccion: las fotos (llaves numericas)
    // vienen MEZCLADAS con metadata del album (`id` del gallery). Ese `id`
    // suelto fue el que rompio el primer sync (zod esperaba un objeto) y el
    // que dejo sin imagenes al segundo (se interpreto como "foto unica").
    galleries: [
      {
        id: 9471716,
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

  it("ignora la metadata del album (id suelto en galleries[0]) — bug real que dejo 61 propiedades sin fotos (2026-07-05)", () => {
    const raw = wasiApiPropertySchema.parse(REAL_SEARCH_RESPONSE["0"]);
    const { imageKeys } = extractImages(raw);
    // El id del gallery (9471716) NO debe aparecer como si fuera una foto.
    expect(imageKeys).not.toContain("9471716");
    expect(imageKeys).toHaveLength(3);
  });

  it("cae a main_image si no hay galleries", () => {
    const raw = wasiApiPropertySchema.parse({
      id_property: 2,
      main_image: { id: 99, url_original: "https://images.wasi.co/inmuebles/solo.jpeg" }
    });
    const { imageUrls } = extractImages(raw);
    expect(imageUrls).toEqual(["https://images.wasi.co/inmuebles/solo.jpeg"]);
  });

  it("cae a main_image si galleries[0] solo trae metadata (sin llaves numericas)", () => {
    const raw = wasiApiPropertySchema.parse({
      id_property: 4,
      main_image: { id: 77, url_original: "https://images.wasi.co/inmuebles/fallback.jpeg" },
      galleries: [{ id: 555 }]
    });
    const { imageUrls } = extractImages(raw);
    expect(imageUrls).toEqual(["https://images.wasi.co/inmuebles/fallback.jpeg"]);
  });

  it("devuelve listas vacias si no hay ninguna imagen", () => {
    const raw = wasiApiPropertySchema.parse({ id_property: 3 });
    expect(extractImages(raw)).toEqual({ imageKeys: [], imageUrls: [] });
  });
});

describe("normalizeArea", () => {
  it("usa area cuando es valida", () => {
    const raw = wasiApiPropertySchema.parse({ id_property: 1, area: "186", built_area: "186", unit_area_label: "M2" });
    expect(normalizeArea(raw)).toBe("186m2");
  });

  it("cae a built_area cuando area viene vacia — caso real id=9861538 (area='' built='160')", () => {
    const raw = wasiApiPropertySchema.parse({ id_property: 1, area: "", built_area: "160", unit_area_label: "M2" });
    expect(normalizeArea(raw)).toBe("160m2");
  });

  it("prefiere el primer candidato >= 10 (area='2' typo, built='80' correcto)", () => {
    const raw = wasiApiPropertySchema.parse({ id_property: 1, area: "2", built_area: "80", unit_area_label: "M2" });
    expect(normalizeArea(raw)).toBe("80m2");
  });

  it("si ningun candidato llega a 10, usa el primero > 0 (dato malo en Wasi, mejor eso que nada)", () => {
    const raw = wasiApiPropertySchema.parse({ id_property: 1, area: "2", built_area: "2", unit_area_label: "M2" });
    expect(normalizeArea(raw)).toBe("2m2");
  });

  it("devuelve null si no hay ningun area", () => {
    const raw = wasiApiPropertySchema.parse({ id_property: 1, area: "", built_area: "", private_area: "" });
    expect(normalizeArea(raw)).toBeNull();
  });
});

describe("tipo desde el catalogo /property-type/all", () => {
  it("mapea id_property_type al nombre del catalogo", () => {
    const raw = wasiApiPropertySchema.parse({ id_property: 1, id_property_type: 2 });
    const types = new Map([[1, "Casa"], [2, "Apartamento"]]);
    expect(toCanonicalProperty(raw, types).tipo).toBe("Apartamento");
  });

  it("tipo null si el id no esta en el catalogo o no hay catalogo", () => {
    const raw = wasiApiPropertySchema.parse({ id_property: 1, id_property_type: 99 });
    expect(toCanonicalProperty(raw, new Map()).tipo).toBeNull();
    expect(toCanonicalProperty(raw).tipo).toBeNull();
  });
});

// GARAJE Y ESTRATO (2026-09-02). Faltaban desde el principio: el sync los
// escribia como null al crear y no los volvia a mirar, asi que llenarlos en
// Wasi no llegaba nunca a la base. Medido ese dia: garaje cargado en el 29%
// del inventario y estrato en el 32%, y los que si estaban venian del import
// de Excel viejo. El radar puntua por lo que puede VERIFICAR, asi que un
// apartamento con garaje sin cargar pierde contra otro del que sabemos menos.
describe("garaje y estrato", () => {
  it("los trae de la API cuando vienen", () => {
    const p = toCanonicalProperty(
      wasiApiPropertySchema.parse({ id_property: 1, reference: "AP1", garages: 2, stratum: 5 })
    );
    expect(p.garaje).toBe(2);
    expect(p.estrato).toBe(5);
  });

  it("acepta que la API los mande como string", () => {
    const p = toCanonicalProperty(
      wasiApiPropertySchema.parse({ id_property: 1, reference: "AP1", garages: "1", stratum: "4" })
    );
    expect(p.garaje).toBe(1);
    expect(p.estrato).toBe(4);
  });

  it("sin el dato quedan en null, nunca en 0 — un cero seria decir que NO tiene", () => {
    const p = toCanonicalProperty(wasiApiPropertySchema.parse({ id_property: 1, reference: "AP1" }));
    expect(p.garaje).toBeNull();
    expect(p.estrato).toBeNull();
  });

  it("un cero explicito de Wasi SI se conserva: significa que no tiene garaje", () => {
    const p = toCanonicalProperty(
      wasiApiPropertySchema.parse({ id_property: 1, reference: "AP1", garages: 0, stratum: 0 })
    );
    expect(p.garaje).toBe(0);
    expect(p.estrato).toBe(0);
  });
});

/**
 * `features` (2026-09-05). Forma real verificada contra produccion con
 * dmap/scripts/wasi-features-crudo.ts: `features.internal` y
 * `features.external`, arrays de {id, nombre, name, own}. Wasi trae dobles
 * espacios ("Urbanización  cerrada") y a veces `name` vacio con `nombre`
 * lleno. 43 de 112 propiedades las traian; el sync no las guardaba y para el
 * radar "unidad cerrada" o "terraza" eran datos que "no registramos".
 */
describe("extractFeatures / caracteristicas", () => {
  const conFeatures = {
    id_property: 1,
    reference: "F1",
    features: {
      internal: [
        { id: 104, nombre: "Admite mascotas", name: "", own: false },
        { id: 12, nombre: "Balcón", name: "", own: false },
        { id: 13, nombre: "", name: "Vista panorámica", own: false }
      ],
      external: [
        { id: 55, nombre: "Urbanización  cerrada", name: "", own: false },
        { id: 56, nombre: "Terraza", name: "", own: false },
        { id: 57, nombre: "balcón", name: "", own: false }
      ]
    }
  };

  it("aplana internas y externas en un texto, en orden, sin dobles espacios ni repetidos", async () => {
    const { extractFeatures } = await import("../../src/sync/wasi-api.source.js");
    const parsed = wasiApiPropertySchema.parse(conFeatures);
    expect(extractFeatures(parsed)).toBe("Admite mascotas, Balcón, Vista panorámica, Urbanización cerrada, Terraza");
  });

  it("sin features (o vacias) la propiedad canonica trae caracteristicas null, no un string vacio", async () => {
    const { extractFeatures } = await import("../../src/sync/wasi-api.source.js");
    expect(extractFeatures(wasiApiPropertySchema.parse({ id_property: 2 }))).toBeNull();
    expect(extractFeatures(wasiApiPropertySchema.parse({ id_property: 3, features: { internal: [], external: [] } }))).toBeNull();
    expect(extractFeatures(wasiApiPropertySchema.parse({ id_property: 4, features: "raro" }))).toBeNull();
  });

  it("toCanonicalProperty lleva las features a caracteristicas", () => {
    const canonical = toCanonicalProperty(wasiApiPropertySchema.parse(conFeatures));
    expect(canonical.caracteristicas).toBe("Admite mascotas, Balcón, Vista panorámica, Urbanización cerrada, Terraza");
  });
});

/**
 * Incidente del 2026-09-09: el sync de Wasi fallo sus 5 corridas del dia con
 * `seen: 0` y el radar quedo mudo 37 h (cuatro pedidos con match descartados
 * por `sync_viejo` esa manana). Causa: Wasi empezo a mandar `main_image` como
 * array en al menos una propiedad, el esquema lo declaraba objeto, y el parse
 * de la pagina era un `.parse()` que lanza dentro de un `.map()` — UNA
 * propiedad rota tumbaba el inventario COMPLETO de la cuenta.
 *
 * Dos defensas, porque son dos fallos distintos:
 *  1. el esquema tolera la forma nueva (esta salida concreta);
 *  2. una propiedad irreparable se descarta sin arrastrar a las demas
 *     (la proxima sorpresa de Wasi, que no sabemos cual va a ser).
 *
 * Y la tercera regla, que es la que impide cambiar un fallo ruidoso por uno
 * callado: lo descartado NO se puede tratar como "ya no esta en Wasi", porque
 * el sync marca vendida toda propiedad que no vuelve a ver.
 */
describe("una propiedad rota no puede tumbar el inventario (incidente 2026-09-09)", () => {
  it("main_image como array vacio: no lanza, y la propiedad queda sin fotos", () => {
    const raw = wasiApiPropertySchema.parse({ id_property: 10113016, main_image: [] });
    expect(extractImages(raw)).toEqual({ imageKeys: [], imageUrls: [] });
  });

  it("main_image como array con fotos: se toma la primera valida", () => {
    const raw = wasiApiPropertySchema.parse({
      id_property: 5,
      main_image: [{ id: 12, url_original: "https://images.wasi.co/inmuebles/desde-array.jpeg" }]
    });
    expect(extractImages(raw).imageUrls).toEqual(["https://images.wasi.co/inmuebles/desde-array.jpeg"]);
  });

  it("parseSearchPage aisla la entrada irreparable y devuelve las sanas", () => {
    const { properties, descartes } = parseSearchPage({
      "0": { id_property: 1, reference: "REF-1" },
      "1": { id_property: 2, bedrooms: { roto: true } },
      "2": { id_property: 3 },
      total: 3,
      status: "success"
    });
    expect(properties.map((p) => String(p.id_property))).toEqual(["1", "3"]);
    expect(descartes).toHaveLength(1);
    expect(descartes[0]!.ref).toBe("2");
  });

  it("la descartada conserva su ref para que NO se marque como retirada", () => {
    const { descartes } = parseSearchPage({ "0": { id_property: 9, reference: "  CASA-9 ", area: { roto: true } } });
    expect(descartes[0]!.ref).toBe("CASA-9");
  });

  it("una entrada sin id recuperable deja ref null — no hay como protegerla", () => {
    const { descartes } = parseSearchPage({ "0": { titulo: "sin id" } });
    expect(descartes).toHaveLength(1);
    expect(descartes[0]!.ref).toBeNull();
  });

  it("el motivo del descarte nombra el campo, para no quedar adivinando", () => {
    const { descartes } = parseSearchPage({ "0": { id_property: 7, bathrooms: { roto: true } } });
    expect(descartes[0]!.motivo).toContain("bathrooms");
  });
});

describe("umbral de descartes: un inventario mutilado NO se da por bueno", () => {
  it("acepta la corrida si los descartes estan por debajo del umbral", () => {
    expect(() => verificarDescartes(100, 4)).not.toThrow();
  });

  it("lanza si pasan el umbral, en vez de sincronizar medio inventario en silencio", () => {
    expect(() => verificarDescartes(100, 20)).toThrow(/aborta la corrida/i);
  });

  it("lanza si Wasi respondio y NADA se pudo parsear", () => {
    expect(() => verificarDescartes(0, 12)).toThrow(/aborta la corrida/i);
  });

  it("una corrida legitimamente vacia (cuenta sin arriendos) no es un error", () => {
    expect(() => verificarDescartes(0, 0)).not.toThrow();
  });

  it("en una cuenta chica manda el piso, no el porcentaje: 1 de 3 no aborta", () => {
    expect(() => verificarDescartes(2, 1)).not.toThrow();
  });

  it("pero el piso tiene fondo: 3 de 5 sigue siendo un inventario mutilado", () => {
    expect(() => verificarDescartes(2, 3)).toThrow(/aborta la corrida/i);
  });
});
