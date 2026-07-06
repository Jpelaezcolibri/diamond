/**
 * Replica exacta de web/lib/slug.ts (buildSlug) y src/lib/slug.js (bot):
 * mismo algoritmo, mismo resultado, para que el link que arma DMAP en los
 * captions coincida con la ruta real que sirve la landing
 * (/propiedades/[slug]). Si cambia uno, cambian los tres.
 */

function slugify(text: string): string {
  return String(text)
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // sin tildes (marcas diacriticas combinantes)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // todo lo demas (emojis incluidos) a guion
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

export function buildSlug(titulo: string, ref: string): string {
  const base = slugify(titulo);
  const refPart = String(ref).toLowerCase();
  return base ? `${base}-${refPart}` : refPart;
}
