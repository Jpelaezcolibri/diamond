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
    id_property_type: z.union([z.number(), z.string()]).nullable().optional(),
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
    built_area: z.union([z.string(), z.number()]).nullable().optional(),
    private_area: z.union([z.string(), z.number()]).nullable().optional(),
    unit_area_label: z.string().nullable().optional(),
    bedrooms: z.union([z.string(), z.number()]).nullable().optional(),
    bathrooms: z.union([z.string(), z.number()]).nullable().optional(),
    zone_label: z.string().nullable().optional(),
    city_label: z.string().nullable().optional(),
    link: z.string().nullable().optional(),
    main_image: wasiImageSchema.nullable().optional(),
    // Peculiaridad de la API (verificada contra produccion): `galleries` es un
    // array con UN solo elemento, que es un objeto con las fotos en llaves
    // numericas ("0","1",...) MEZCLADAS con metadata del album (`id`, etc.).
    // Por eso el valor es z.unknown(): la extraccion real (solo llaves
    // numericas) vive en extractImages().
    galleries: z.array(z.record(z.string(), z.unknown())).optional()
  })
  .passthrough();

export type WasiApiProperty = z.infer<typeof wasiApiPropertySchema>;

/** Extrae las entradas con llave numerica ("0","1",...) de una respuesta estilo Wasi (ignora total/status/metadata). */
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

/**
 * Wasi trae tres campos de area y cualquiera puede venir vacio o con un typo
 * ("" o "2" con built_area correcto — casos reales de esta cuenta). Se toma
 * el primero >= 10 m2; si ninguno alcanza, el primero > 0; si no hay nada,
 * null. Verificado 2026-07-05: id=9861538 tiene area="" y built_area="160".
 */
export function normalizeArea(p: WasiApiProperty): string | null {
  const candidates = [p.area, p.built_area, p.private_area]
    .map(toNumberOrNull)
    .filter((n): n is number => n !== null && n > 0);
  if (candidates.length === 0) return null;
  const value = candidates.find((n) => n >= 10) ?? candidates[0]!;
  const unit = (p.unit_area_label ?? "M2").toLowerCase();
  return `${value}${unit}`;
}

function parseWasiImage(raw: unknown): WasiImage | null {
  if (!raw || typeof raw !== "object") return null;
  const parsed = wasiImageSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * `galleries[0]` mezcla las fotos (llaves numericas "0","1",...) con metadata
 * del album (`id` del gallery, etc.) — descubierto en produccion: el primer
 * intento asumio que un `id` directo significaba "una sola foto" y dejo las
 * 61 propiedades nuevas sin imagenes. Solo se toman las llaves numericas,
 * ordenadas por `position`, usando `url_original` (CDN directo, sin proxy).
 */
export function extractImages(p: WasiApiProperty): { imageKeys: string[]; imageUrls: string[] } {
  const container = p.galleries?.[0] as Record<string, unknown> | undefined;
  let images: WasiImage[] = [];

  if (container) {
    images = Object.entries(container)
      .filter(([key]) => /^\d+$/.test(key))
      .map(([, value]) => parseWasiImage(value))
      .filter((img): img is WasiImage => img !== null);
  }
  if (images.length === 0 && p.main_image) {
    images = [p.main_image];
  }

  const sorted = [...images].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const imageKeys = sorted.map((img) => (img.id != null ? String(img.id) : img.filename)).filter((k): k is string => Boolean(k));
  const imageUrls = sorted.map((img) => img.url_original).filter((u): u is string => Boolean(u));
  return { imageKeys, imageUrls };
}

export type PropertyTypeMap = Map<number, string>;

export function toCanonicalProperty(raw: WasiApiProperty, propertyTypes: PropertyTypeMap = new Map()): CanonicalProperty {
  const { operacion, precio } = normalizeOperacionYPrecio(raw);
  const { imageKeys, imageUrls } = extractImages(raw);
  const typeId = toNumberOrNull(raw.id_property_type);

  return {
    ref: raw.reference?.trim() || String(raw.id_property),
    titulo: raw.title ?? null,
    tipo: (typeId !== null ? propertyTypes.get(typeId) : null) ?? null,
    operacion,
    precio,
    descripcion: raw.observations ?? null,
    area: normalizeArea(raw),
    habitaciones: toNumberOrNull(raw.bedrooms),
    banos: toNumberOrNull(raw.bathrooms),
    zona: raw.zone_label ?? null,
    ciudad: raw.city_label ?? null,
    link: raw.link ?? null,
    imageKeys,
    imageUrls
  };
}

const wasiPropertyTypeSchema = z
  .object({
    id_property_type: z.union([z.number(), z.string()]),
    nombre: z.string().optional(),
    name: z.string().optional()
  })
  .passthrough();

/** Un link de propiedad gestionada por Wasi (pagina publica vieja o sitio inmo.co nuevo). */
function isWasiManagedLink(link: string | null): boolean {
  return Boolean(link && /info\.wasi\.co|\.inmo\.co/.test(link));
}

/**
 * Fuente oficial (api.wasi.co) — a diferencia de wasi-public, puede
 * DESCUBRIR propiedades nuevas (propertyId null -> evento 'created' real) y
 * DETECTAR retiros: como ve el inventario completo, toda propiedad Wasi de
 * la org que ya no aparezca en el listado se reporta `gone` (vendida o
 * despublicada) para que sync.service la marque no disponible. Se activa
 * cambiando org_marketing_settings.sync_source a 'wasi_api', sin tocar codigo.
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

    const query = async (path: string, params: Record<string, string>): Promise<unknown> => {
      const url = new URL(`${WASI_API_BASE}${path}`);
      url.searchParams.set("id_company", idCompany);
      url.searchParams.set("wasi_token", wasiToken);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Wasi API respondio ${response.status} en ${path}`);
      }
      return response.json();
    };

    // Catalogo de tipos (id -> "Apartamento", "Casa", ...) para poblar properties.tipo.
    const propertyTypes: PropertyTypeMap = new Map();
    try {
      const typesBody = await query("/property-type/all", {});
      for (const entry of extractPropertyEntries(typesBody)) {
        const parsed = wasiPropertyTypeSchema.safeParse(entry);
        if (!parsed.success) continue;
        const id = toNumberOrNull(parsed.data.id_property_type);
        const nombre = parsed.data.nombre ?? parsed.data.name;
        if (id !== null && nombre) propertyTypes.set(id, nombre);
      }
    } catch {
      // El catalogo es un enriquecimiento: si falla, el sync sigue sin tipo.
    }

    const fetchPaginated = async (extraParams: Record<string, string>): Promise<WasiApiProperty[]> => {
      const results: WasiApiProperty[] = [];
      let skip = 0;
      for (;;) {
        const body = await query("/property/search", { take: String(PAGE_SIZE), skip: String(skip), ...extraParams });
        const entries = extractPropertyEntries(body).map((entry) => wasiApiPropertySchema.parse(entry));
        if (entries.length === 0) break;
        results.push(...entries);
        skip += PAGE_SIZE;
        if (entries.length < PAGE_SIZE) break;
      }
      return results;
    };

    // Dos pasadas (venta y arriendo) unidas por id: verificado en produccion
    // que la busqueda con for_sale=true trae solo ventas; los arriendos que
    // el cliente cargue despues llegan por la pasada for_rent=true.
    const seenIds = new Set<string>();
    const allProperties: WasiApiProperty[] = [];
    const passes: Record<string, string>[] = [{ for_sale: "true" }, { for_rent: "true" }];
    for (const pass of passes) {
      for (const property of await fetchPaginated(pass)) {
        const id = String(property.id_property);
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        allProperties.push(property);
      }
    }

    const existing = await listPropertiesByOrg(orgId);
    const existingByRef = new Map(existing.map((p) => [p.ref, p.id]));

    const candidates: SyncCandidate[] = allProperties.map((raw) => {
      const data = toCanonicalProperty(raw, propertyTypes);
      return {
        propertyId: existingByRef.get(data.ref) ?? null,
        wasiId: String(raw.id_property),
        gone: false,
        data
      };
    });

    // Retiros: propiedades Wasi de la org, aun disponibles, que ya no estan
    // en el inventario de la API (vendidas o despublicadas en Wasi).
    const fetchedRefs = new Set(candidates.map((c) => c.data!.ref));
    for (const property of existing) {
      if (!property.disponible) continue;
      if (fetchedRefs.has(property.ref)) continue;
      if (!isWasiManagedLink(property.link)) continue;
      candidates.push({ propertyId: property.id, wasiId: null, gone: true, data: null });
    }

    return candidates;
  }
}
