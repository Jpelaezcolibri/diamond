import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BUG (2026-10-17): una propiedad que el sync dio de baja y despues vuelve a
 * publicarse en Wasi nunca se reactivaba: el sync solo cambia `disponible`
 * cuando el diff ve un status_changed, y el snapshot de la fuente siempre la
 * tuvo publicada. Caso real: la 9921084 (Urbanity, Guayabal, $565M) retirada
 * el 11-ago, publicada en Wasi el 17-oct, y para el radar y Sofi no existia.
 */

vi.mock("../../src/repositories/settings.repo.js", () => ({
  getOrgMarketingSettings: vi.fn(async () => ({ wasi_id_company_enc: "enc-id", wasi_token_enc: "enc-token" }))
}));
vi.mock("../../src/security/crypto.js", () => ({ decryptSecret: vi.fn(() => "descifrado") }));
const listPropertiesByOrg = vi.fn(async () => [] as unknown[]);
vi.mock("../../src/repositories/properties.repo.js", () => ({ listPropertiesByOrg }));

const { WasiApiSource } = await import("../../src/sync/wasi-api.source.js");
const { patchReaparicion } = await import("../../src/sync/refresh.js");

const sana = (id: number) => ({ id_property: id, reference: `${id}`, for_sale: "true", title: `Apto ${id}` });
const comoRespuesta = (items: unknown[]) =>
  Object.fromEntries([...items.map((it, i) => [String(i), it]), ["total", items.length], ["status", "success"]]);

beforeEach(() => {
  vi.clearAllMocks();
  let llamadas = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: URL | string) => {
    const body = String(url).includes("/property-type/all") ? comoRespuesta([]) : (llamadas++ === 0 ? comoRespuesta([sana(9921084)]) : comoRespuesta([]));
    return { ok: true, status: 200, json: async () => body } as Response;
  }));
});

describe("propiedad que vuelve a Wasi", () => {
  it("la fuente la marca como reaparecida si en la base estaba retirada", async () => {
    listPropertiesByOrg.mockResolvedValue([{ id: "uuid-1", ref: "9921084", disponible: false, link: "https://paraisoinmobiliario.inmo.co/x/9921084" }] as never);
    const [c] = await new WasiApiSource().fetchCandidates("org-1");
    expect(c!.propertyId).toBe("uuid-1");
    expect(c!.reaparece).toBe(true);
  });

  it("una que ya estaba disponible no se marca", async () => {
    listPropertiesByOrg.mockResolvedValue([{ id: "uuid-1", ref: "9921084", disponible: true, link: "https://paraisoinmobiliario.inmo.co/x/9921084" }] as never);
    const [c] = await new WasiApiSource().fetchCandidates("org-1");
    expect(c!.reaparece).toBeFalsy();
  });

  it("patchReaparicion la vuelve a poner disponible", () => {
    expect(patchReaparicion({ reaparece: true })).toEqual({ disponible: true });
    expect(patchReaparicion({ reaparece: false })).toEqual({});
    expect(patchReaparicion({})).toEqual({});
  });
});
