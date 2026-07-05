import { logger } from "../lib/logger.js";
import { listWasiPublicProperties, type PropertyRow } from "../repositories/properties.repo.js";
import type { CanonicalProperty, SyncCandidate, WasiSource } from "./wasi-source.js";

const IMG_WIDTH = 1600;
const RATE_LIMIT_MS = 400;

export interface ParsedWasiPage {
  operacion: "Venta" | "Arriendo" | null;
  precio: string | null;
  titulo: string | null;
  precioRegexOk: boolean;
}

/**
 * Port fiel de extract_images() en scripts/sync_wasi_public.py: decodifica el
 * payload base64 de cada URL image.wasi.co/<b64> embebida en el HTML, se
 * queda con las fotos del inmueble (prefijo "inmuebles/", sin duplicados) y
 * devuelve solo las KEYS en orden de galeria (no las URLs — eso es buildImageUrls).
 */
export function extractImageKeys(html: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const matches = html.matchAll(/https:\/\/image\.wasi\.co\/([A-Za-z0-9+/=]+)/g);
  for (const match of matches) {
    const b64 = match[1];
    if (!b64) continue;
    let payload: { key?: string };
    try {
      const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
      payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    } catch {
      continue;
    }
    const key = payload.key ?? "";
    if (!key.startsWith("inmuebles/") || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

/** Re-encodea las keys al proxy de Wasi con el ancho pedido para la landing. */
export function buildImageUrls(imageKeys: string[], width = IMG_WIDTH): string[] {
  return imageKeys.map((key) => {
    const payload = {
      bucket: "staticw",
      key,
      edits: { normalise: true, rotate: 0, resize: { width, fit: "inside" } }
    };
    const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
    return `https://image.wasi.co/${b64}`;
  });
}

const PRECIO_RE = /Precio\s+(venta|renta)\s*<p class="pr1">\s*(\$[\d.]+)/;
const TITLE_RE = /<title>([\s\S]*?)<\/title>/;

/** Port de las regex de precio/titulo del script Python. */
export function parseWasiPage(html: string): ParsedWasiPage {
  const precioMatch = PRECIO_RE.exec(html);
  const titleMatch = TITLE_RE.exec(html);
  if (!precioMatch) {
    return { operacion: null, precio: null, titulo: titleMatch?.[1]?.trim() ?? null, precioRegexOk: false };
  }
  return {
    operacion: precioMatch[1] === "renta" ? "Arriendo" : "Venta",
    precio: precioMatch[2] ?? null,
    titulo: titleMatch?.[1]?.trim() ?? null,
    precioRegexOk: true
  };
}

/**
 * Guardian de sanidad del script original: una VENTA por menos de $50M es
 * casi seguro un error de digitacion en Wasi (ej. $1.550.000 en vez de
 * $1.550.000.000) — nunca se propaga.
 */
export function isSuspiciousVentaPrice(operacion: string | null, precio: string | null): boolean {
  if (operacion !== "Venta" || !precio) return false;
  const monto = Number(precio.replace(/\D/g, "")) || 0;
  return monto < 50_000_000;
}

export interface WasiPublicFetchResult {
  gone: boolean;
  parsed: ParsedWasiPage | null;
  imageKeys: string[];
}

async function fetchWasiPublicPage(link: string): Promise<WasiPublicFetchResult> {
  const url = encodeURI(link.trim());
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (response.status === 404 || response.status === 410) {
    return { gone: true, parsed: null, imageKeys: [] };
  }
  if (!response.ok) {
    throw new Error(`Wasi respondio ${response.status} para ${link}`);
  }
  const html = await response.text();
  return { gone: false, parsed: parseWasiPage(html), imageKeys: extractImageKeys(html) };
}

function toCanonicalProperty(property: PropertyRow, fetched: WasiPublicFetchResult): CanonicalProperty {
  const parsed = fetched.parsed;
  const precio =
    parsed?.precio && !isSuspiciousVentaPrice(parsed.operacion, parsed.precio) ? parsed.precio : property.precio;
  return {
    ref: property.ref,
    titulo: parsed?.titulo ?? property.titulo,
    tipo: property.tipo,
    operacion: (parsed?.operacion as "Venta" | "Arriendo" | null) ?? (property.operacion as "Venta" | "Arriendo" | null),
    precio,
    descripcion: property.descripcion,
    area: property.area,
    habitaciones: property.habitaciones,
    banos: property.banos,
    zona: property.zona,
    ciudad: property.ciudad,
    link: property.link,
    imageKeys: fetched.imageKeys,
    imageUrls: fetched.imageKeys.length > 0 ? buildImageUrls(fetched.imageKeys) : property.images
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fuente de sincronizacion activa por defecto (ver ARCHITECTURE.md #5):
 * solo puede REFRESCAR propiedades que ya existen en `properties` con un
 * link publico de info.wasi.co (a diferencia de wasi-api, no descubre
 * propiedades nuevas — esas entran hoy por scripts/import_excel.py).
 */
export class WasiPublicSource implements WasiSource {
  readonly kind = "wasi_public" as const;

  async fetchCandidates(orgId: string): Promise<SyncCandidate[]> {
    const properties = await listWasiPublicProperties(orgId);
    const candidates: SyncCandidate[] = [];

    for (const property of properties) {
      if (!property.link) continue;
      try {
        const fetched = await fetchWasiPublicPage(property.link);
        if (fetched.gone) {
          candidates.push({ propertyId: property.id, wasiId: null, gone: true, data: null });
        } else {
          if (fetched.parsed && !fetched.parsed.precioRegexOk) {
            logger.warn({ ref: property.ref }, "Wasi cambio el HTML: precio no encontrado, revisar regex");
          }
          candidates.push({
            propertyId: property.id,
            wasiId: null,
            gone: false,
            data: toCanonicalProperty(property, fetched)
          });
        }
      } catch (err) {
        logger.error({ err, ref: property.ref }, "Error leyendo pagina publica de Wasi");
      }
      await sleep(RATE_LIMIT_MS);
    }

    return candidates;
  }
}
