import { createHash } from "node:crypto";

/**
 * Campos que definen si el CONTENIDO comercial de una propiedad cambio
 * (ver dmap/ARCHITECTURE.md #5 — content_hash). Deliberadamente NO incluye
 * imagenes: esas se hashean aparte (images_hash) porque cambian con otra
 * cadencia y disparan otro tipo de evento (photos_changed).
 */
export interface HashableContent {
  precio: string | null;
  operacion: string | null;
  titulo: string | null;
  descripcion: string | null;
  disponible: boolean;
  area: string | null;
  habitaciones: number | null;
  banos: number | null;
  zona: string | null;
}

function canonicalJSON(value: object): string {
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(Object.fromEntries(entries));
}

export function computeContentHash(content: HashableContent): string {
  return createHash("sha256").update(canonicalJSON(content)).digest("hex");
}

/**
 * Hashea las KEYS de imagen de Wasi (ej. "inmuebles/abc123.jpg"), no las URLs
 * del proxy image.wasi.co — esas embeben parametros de tamano y cambiarian
 * el hash sin que la foto haya cambiado realmente.
 */
export function computeImagesHash(imageKeys: string[]): string {
  return createHash("sha256").update(imageKeys.join("|")).digest("hex");
}
