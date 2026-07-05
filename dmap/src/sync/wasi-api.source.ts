import { z } from "zod";
import { decryptSecret } from "../security/crypto.js";
import { getOrgMarketingSettings } from "../repositories/settings.repo.js";
import { listPropertiesByOrg } from "../repositories/properties.repo.js";
import type { CanonicalProperty, SyncCandidate, WasiSource } from "./wasi-source.js";

const WASI_API_BASE = "https://api.wasi.co/v1";
const PAGE_SIZE = 100;

/**
 * Forma real de api.wasi.co/v1/property/search, verificada contra la cuenta
 * de produccion de Diamond (2026-07-05) — ver dmap/ARCHITECTURE.md #15.
 * El endpoint devuelve un objeto con las propiedades en llaves numericas
 * ("0","1",...) mas `total`/`status` como hermanos, NO un array envuelto en
 * `{data: [...]}` como se asumio originalmente antes de tener credenciales
 * reales. `.passthrough()` en cada propiedad para no reventar si Wasi
 * agrega/renombra campos que aun no mapeamos.
 */
const wasiImageSchema = z
  .object({
    id: z.union([z.number(), z.string()]).optional(),
    filename: z.string().optional(),
    position: z.number().optional(),
    url: z.string().optional(),
    url_big: z.string().optional(),
    url_original: z.string().optional()
  })
  .passthrough();

type WasiImage = z.infer<typeof wasiImageSchema>;

export const wasiApiPropertySchema = z
  .object({
    id_property: z.union([z.number(), z.string()]),
    title: z.string().nullable().optional(),
    reference: z.string().nullable().optional(),
    for_sale: z.union([z.string(), z.boolean()]).optional(),
    for_rent: z.union([z.string(), z.boolean()]).optional(),
    sale_price: z.union([z.string(), z.number()]).nullable().optional(),
    sale_price_label: z.string().nullable().optional(),
    rent_price: z.union([z.string(), z.number()]).nullable().optional(),
    rent_price_label: z.string().nullable().optional(),
    observations: z.string().nullable().optional(),
    area: z.union([z.string(), z.number()]).nullable().optional(),
    unit_area_label: z.string().nullable().optional(),
    bedrooms: z.union([z.string(), z.number()]).nullable().optional(),
    bathrooms: z.union([z.string(), z.number()]).nullable().optional(),
    zone_label: z.string().nullable().optional(),
    city_label: z.string().nullable().optional(),
    link: z.string().nullable().optional(),
    main_image: wasiImageSchema.nullable().optional(),
    // Peculiaridad de la API: `galleries` es un array con UN solo elemento,
    // que a su vez es un objeto indexado por posicion ("0","1",...).
    galleries: z.array(z.record(z.string(), wasiImageSchema)).optional()
  })
  .passthrough();

export type WasiApiProperty = z.infer<typeof wasiApiPropertySchema>;

/** Extrae las entradas de propiedad (llaves numericas) de la respuesta de /property/search. */
export function extractPropertyEntries(raw: unknown): unknown[] {
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw as Record<string, unknown>)
    .filter(([key]) => /^\d+$/.test(key))
    .map(([, value]) => value);
}

function toNumberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isTrue(value: string | boolean | undefined): boolean {
  return value === true || value === "true";
}

export function normalizeOperacionYPrecio(p: WasiApiProperty): { operacion: "Venta" | "Arriendo" | null; precio: string | null } {
  if (isTrue(p.for_sale)) {
    return { operacion: "Venta", precio: p.sale_price_label ?? (p.sale_price != null ? String(p.sale_price) : null) };
  }
  if (isTrue(p.for_rent)) {
    return { operacion: "Arriendo", precio: p.rent_price_label ?? (p.rent_price != null ? String(p.rent_price) : null) };
  }
  return { operacion: null, precio: null };
}

/** `galleries[0]` es el (unico) contenedor indexado; se ordena por `position` y se usa `url_original` (CDN directo, sin proxy de resize). */
export function extractImages(p: WasiApiProperty): { imageKeys: string[]; imageUrls: string[] } {
  const container = p.galleries?.[0];
  const images: WasiImage[] = container
    ? Object.values(container)
    : p.main_image
      ? [p.main_image]
      : [];

  const sorted = [...images].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const imageKeys = sorted.map((img) => (img.id != null ? String(img.id) : img.filename)).filter((k): k is string => Boolean(k));
  const imageUrls = sorted.map((img) => img.url_original).filter((u): u is string => Boolean(u));
  return { imageKeys, imageUrls };
}

export function toCanonicalProperty(raw: WasiApiProperty): CanonicalProperty {
  const { operacion, precio } = normalizeOperacionYPrecio(raw);
  const { imageKeys, imageUrls } = extractImages(raw);
  const area = raw.area != null ? `${raw.area}${(raw.unit_area_label ?? "").toLowerCase()}` : null;

  return {
    ref: raw.reference?.trim() || String(raw.id_property),
    titulo: raw.title ?? null,
    operacion,
    precio,
    descripcion: raw.observations ?? null,
    area,
    habitaciones: toNumberOrNull(raw.bedrooms),
    banos: toNumberOrNull(raw.bathrooms),
    zona: raw.zone_label ?? null,
    ciudad: raw.city_label ?? null,
    link: raw.link ?? null,
    imageKeys,
    imageUrls
  };
}

/**
 * Fuente oficial (api.wasi.co) — a diferencia de wasi-public, puede
 * DESCUBRIR propiedades nuevas (propertyId null -> evento 'created' real,
 * no solo refresco). Se activa cambiando org_marketing_settings.sync_source
 * a 'wasi_api', sin tocar codigo.
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
      const body = await response.json();
      const entries = extractPropertyEntries(body).map((entry) => wasiApiPropertySchema.parse(entry));
      if (entries.length === 0) break;

      for (const raw of entries) {
        const data = toCanonicalProperty(raw);
        candidates.push({
          propertyId: existingByRef.get(data.ref) ?? null,
          wasiId: String(raw.id_property),
          gone: false,
          data
        });
      }

      skip += PAGE_SIZE;
      if (entries.length < PAGE_SIZE) break;
    }

    return candidates;
  }
}
