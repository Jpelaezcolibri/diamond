import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * INCIDENTE 2026-10-16 (7 p. m.): Wasi rechazo las credenciales y respondio
 * HTTP 200 con {"status":"error","message":"id_company or wasi_token is wrong."}.
 * parseSearchPage leyo eso como una pagina vacia, la corrida "vio" 0
 * propiedades y el barrido de retiros dio de baja las 105 disponibles
 * (seen 105, removed 105). El radar y Sofi se quedaron sin inventario y nada
 * fallo: la corrida termino en 'success'.
 */

vi.mock("../../src/repositories/settings.repo.js", () => ({
  getOrgMarketingSettings: vi.fn(async () => ({ wasi_id_company_enc: "enc-id", wasi_token_enc: "enc-token" }))
}));
vi.mock("../../src/security/crypto.js", () => ({ decryptSecret: vi.fn(() => "descifrado") }));
const listPropertiesByOrg = vi.fn(async () => [] as unknown[]);
vi.mock("../../src/repositories/properties.repo.js", () => ({ listPropertiesByOrg }));

const { WasiApiSource } = await import("../../src/sync/wasi-api.source.js");

const ORG = "org-1";
const sana = (id: number) => ({ id_property: id, reference: `${id}`, for_sale: "true", title: `Casa ${id}` });
const comoRespuesta = (items: unknown[]) =>
  Object.fromEntries([...items.map((it, i) => [String(i), it]), ["total", items.length], ["status", "success"]]);
const enBase = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `uuid-${i}`,
    ref: `${1000 + i}`,
    disponible: true,
    link: `https://paraisoinmobiliario.inmo.co/x/${1000 + i}`
  }));

function moquear(responder: (href: string) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string) => {
      const body = responder(String(url));
      return { ok: true, status: 200, json: async () => body } as Response;
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listPropertiesByOrg.mockResolvedValue([]);
});

describe("Wasi responde 200 con status 'error'", () => {
  it("la corrida FALLA con el mensaje de Wasi, en vez de leer un inventario vacio", async () => {
    listPropertiesByOrg.mockResolvedValue(enBase(105) as never);
    moquear(() => ({ code: "0", status: "error", message: "id_company or wasi_token is wrong." }));
    await expect(new WasiApiSource().fetchCandidates(ORG)).rejects.toThrow(/id_company or wasi_token is wrong/);
  });
});

describe("freno de retiros masivos", () => {
  it("si Wasi no trae NADA y la base tiene disponibles, la corrida falla y no retira ninguna", async () => {
    listPropertiesByOrg.mockResolvedValue(enBase(105) as never);
    moquear((href) => comoRespuesta([]));
    await expect(new WasiApiSource().fetchCandidates(ORG)).rejects.toThrow(/retir/i);
  });

  it("si la corrida retiraria mas de la mitad del inventario, falla", async () => {
    listPropertiesByOrg.mockResolvedValue(enBase(40) as never);
    let llamadas = 0;
    moquear((href) => {
      if (href.includes("/property-type/all")) return comoRespuesta([]);
      llamadas += 1;
      return llamadas === 1 ? comoRespuesta([sana(1000), sana(1001), sana(1002)]) : comoRespuesta([]);
    });
    await expect(new WasiApiSource().fetchCandidates(ORG)).rejects.toThrow(/retir/i);
  });

  it("unos pocos retiros normales siguen pasando", async () => {
    listPropertiesByOrg.mockResolvedValue(enBase(40) as never);
    const vivas = Array.from({ length: 37 }, (_, i) => sana(1000 + i));
    let llamadas = 0;
    moquear((href) => {
      if (href.includes("/property-type/all")) return comoRespuesta([]);
      llamadas += 1;
      return llamadas === 1 ? comoRespuesta(vivas) : comoRespuesta([]);
    });
    const candidatos = await new WasiApiSource().fetchCandidates(ORG);
    expect(candidatos.filter((c) => c.gone)).toHaveLength(3);
  });
});
