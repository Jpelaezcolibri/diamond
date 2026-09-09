import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ejercita fetchCandidates() DE VERDAD, con la API de Wasi moqueada.
 *
 * POR QUE UN TEST APARTE (incidente del 2026-09-09): el arreglo que aisla la
 * entrada rota vive en tres sitios —el parse, el corte de la paginacion y el
 * barrido de retiros— y los tres solo se tocan desde aca. Probar unicamente
 * parseSearchPage() dejaria la suite en verde con el cableado roto, que es
 * exactamente como la linea de DM estuvo muda 18 dias.
 */

vi.mock("../../src/repositories/settings.repo.js", () => ({
  getOrgMarketingSettings: vi.fn(async () => ({ wasi_id_company_enc: "enc-id", wasi_token_enc: "enc-token" }))
}));
vi.mock("../../src/security/crypto.js", () => ({ decryptSecret: vi.fn(() => "descifrado") }));
const listPropertiesByOrg = vi.fn(async () => [] as unknown[]);
vi.mock("../../src/repositories/properties.repo.js", () => ({ listPropertiesByOrg }));

const { WasiApiSource } = await import("../../src/sync/wasi-api.source.js");

const ORG = "org-1";
const sana = (id: number) => ({ id_property: id, reference: `REF-${id}`, for_sale: "true", title: `Casa ${id}` });
/** La forma exacta que tumbo el sync en produccion: main_image como array. */
const conMainImageArray = (id: number) => ({ ...sana(id), main_image: [] });
/** Una sorpresa cualquiera de Wasi: un campo escalar que llega como objeto. */
const irreparable = (id: number) => ({ ...sana(id), bedrooms: { valor: 3 } });

const comoRespuesta = (items: unknown[]) =>
  Object.fromEntries([...items.map((it, i) => [String(i), it]), ["total", items.length], ["status", "success"]]);

/** Encola las respuestas de /property/search en orden; /property-type/all va aparte. */
function moquearWasi(paginas: unknown[][]) {
  const cola = [...paginas];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string) => {
      const href = String(url);
      const body = href.includes("/property-type/all") ? comoRespuesta([]) : comoRespuesta(cola.shift() ?? []);
      return { ok: true, status: 200, json: async () => body } as Response;
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listPropertiesByOrg.mockResolvedValue([]);
});

describe("fetchCandidates: una propiedad rota no tumba el inventario", () => {
  it("devuelve las sanas y omite la rota, en vez de lanzar", async () => {
    moquearWasi([[sana(1), irreparable(2), sana(3)], []]);
    const candidatos = await new WasiApiSource().fetchCandidates(ORG);
    expect(candidatos.map((c) => c.wasiId)).toEqual(["1", "3"]);
  });

  it("la que llego con main_image como array SI entra — es la forma nueva, no un error", async () => {
    moquearWasi([[conMainImageArray(10113016)], []]);
    const candidatos = await new WasiApiSource().fetchCandidates(ORG);
    expect(candidatos).toHaveLength(1);
    expect(candidatos[0]!.data!.imageUrls).toEqual([]);
  });

  it("NO marca como retirada la propiedad que se descarto: sigue estando en Wasi", async () => {
    listPropertiesByOrg.mockResolvedValue([
      { id: "uuid-2", ref: "REF-2", disponible: true, link: "https://paraisoinmobiliario.inmo.co/x/2" }
    ] as never);
    moquearWasi([[sana(1), irreparable(2)], []]);
    const candidatos = await new WasiApiSource().fetchCandidates(ORG);
    expect(candidatos.filter((c) => c.gone)).toEqual([]);
  });

  it("una propiedad que de verdad desaparecio de Wasi SI se marca retirada", async () => {
    listPropertiesByOrg.mockResolvedValue([
      { id: "uuid-9", ref: "REF-9", disponible: true, link: "https://paraisoinmobiliario.inmo.co/x/9" }
    ] as never);
    moquearWasi([[sana(1)], []]);
    const candidatos = await new WasiApiSource().fetchCandidates(ORG);
    expect(candidatos.filter((c) => c.gone).map((c) => c.propertyId)).toEqual(["uuid-9"]);
  });

  it("un descarte no corta la paginacion: la pagina llena sigue a la siguiente", async () => {
    const llena = [...Array(99).keys()].map((i) => sana(i + 1));
    moquearWasi([[...llena, irreparable(999)], [sana(500)], []]);
    const candidatos = await new WasiApiSource().fetchCandidates(ORG);
    expect(candidatos.map((c) => c.wasiId)).toContain("500");
    expect(candidatos).toHaveLength(100);
  });

  it("si Wasi cambio de forma y casi nada parsea, la corrida FALLA en vez de sincronizar medio inventario", async () => {
    moquearWasi([[sana(1), irreparable(2), irreparable(3), irreparable(4)], []]);
    await expect(new WasiApiSource().fetchCandidates(ORG)).rejects.toThrow(/aborta la corrida/i);
  });
});
