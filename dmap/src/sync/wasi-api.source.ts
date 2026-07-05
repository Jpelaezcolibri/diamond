import { z } from "zod";
import { decryptSecret } from "../security/crypto.js";
import { getOrgMarketingSettings } from "../repositories/settings.repo.js";
import { listPropertiesByOrg } from "../repositories/properties.repo.js";
import type { CanonicalProperty, SyncCandidate, WasiSource } from "./wasi-source.js";

const WASI_API_BASE = "https://api.wasi.co/v1";
const PAGE_SIZE = 100;

/**
 * Forma de la respuesta de api.wasi.co/v1/property/search — best-effort,
 * pendiente de verificar contra la documentacion real una vez que Juan
 * obtenga `id_company` + `wasi_token` (ver dmap/ARCHITECTURE.md #15, WP2).
 * .passthrough() para no reventar si Wasi agrega/renombra campos que aun
 * no mapeamos.
 */
const wasiApiPropertySchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    ref: z.string().optional(),
    reference: z.string().optional(),
    title: z.string().nullable().optional(),
    operation: z.string().nullable().optional(),
    price: z.union([z.string(), z.number()]).nullable().optional(),
    description: z.string().nullable().optional(),
    area: z.union([z.string(), z.number()]).nullable().optional(),
    rooms: z.number().nullable().optional(),
    bathrooms: z.number().nullable().optional(),
    zone: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    public_url: z.string().nullable().optional(),
    images: z.array(z.object({ key: z.string().optional(), url: z.string().optional() })).optional(),
    status: z.string().nullable().optional()
  })
  .passthrough();

const wasiApiSearchResponseSchema = z.object({
  data: z.array(wasiApiPropertySchema).default([]),
  total: z.number().optional()
});

type WasiApiProperty = z.infer<typeof wasiApiPropertySchema>;

function normalizeOperacion(raw: string | null | undefined): "Venta" | "Arriendo" | null {
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (v.includes("arriend") || v.includes("renta") || v.includes("rent")) return "Arriendo";
  if (v.includes("vent") || v.includes("sale")) return "Venta";
  return null;
}

function toCanonicalProperty(raw: WasiApiProperty): CanonicalProperty {
  const imageKeys = (raw.images ?? []).map((img) => img.key).filter((k): k is string => Boolean(k));
  const imageUrls = (raw.images ?? []).map((img) => img.url).filter((u): u is string => Boolean(u));
  return {
    ref: raw.ref ?? raw.reference ?? String(raw.id),
    titulo: raw.title ?? null,
    operacion: normalizeOperacion(raw.operation),
    precio: raw.price != null ? String(raw.price) : null,
    descripcion: raw.description ?? null,
    area: raw.area != null ? String(raw.area) : null,
    habitaciones: raw.rooms ?? null,
    banos: raw.bathrooms ?? null,
    zona: raw.zone ?? null,
    ciudad: raw.city ?? null,
    link: raw.public_url ?? null,
    imageKeys,
    imageUrls
  };
}

/**
 * Fuente oficial (api.wasi.co) — a diferencia de wasi-public, puede
 * DESCUBRIR propiedades nuevas (propertyId null -> evento 'created' real,
 * no solo refresco). Bloqueada hasta que lleguen las credenciales
 * (id_company + wasi_token); se activa cambiando
 * org_marketing_settings.sync_source a 'wasi_api', sin tocar codigo.
 */
export class WasiApiSource implements WasiSource {
  readonly kind = "wasi_api" as const;

  async fetchCandidates(orgId: string): Promise<SyncCandidate[]> {
    const settings = await getOrgMarketingSettings(orgId);
    if (!settings.wasi_id_company_enc || !settings.wasi_token_enc) {
      throw new Error(
        `Organizacion ${orgId}: faltan credenciales de la API oficial de Wasi (org_marketing_settings.wasi_id_company_enc / wasi_token_enc)`
      );
    }
    const idCompany = decryptSecret(settings.wasi_id_company_enc);
    const wasiToken = decryptSecret(settings.wasi_token_enc);

    const existingByRef = new Map((await listPropertiesByOrg(orgId)).map((p) => [p.ref, p.id]));
    const candidates: SyncCandidate[] = [];
    let skip = 0;

    for (;;) {
      const url = new URL(`${WASI_API_BASE}/property/search`);
      url.searchParams.set("id_company", idCompany);
      url.searchParams.set("wasi_token", wasiToken);
      url.searchParams.set("take", String(PAGE_SIZE));
      url.searchParams.set("skip", String(skip));

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Wasi API respondio ${response.status} en property/search`);
      }
      const parsed = wasiApiSearchResponseSchema.parse(await response.json());
      if (parsed.data.length === 0) break;

      for (const raw of parsed.data) {
        const data = toCanonicalProperty(raw);
        candidates.push({
          propertyId: existingByRef.get(data.ref) ?? null,
          wasiId: String(raw.id),
          gone: false,
          data
        });
      }

      skip += PAGE_SIZE;
      if (parsed.data.length < PAGE_SIZE) break;
    }

    return candidates;
  }
}
