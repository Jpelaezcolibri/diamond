// Espejo de dmap/src/lib/slug.ts / web/lib/slug.ts (buildSlug): mismo
// algoritmo, mismo resultado, para que la vista previa del caption en el
// Content Studio muestre el MISMO link que arma DMAP al publicar.

function slugify(text: string): string {
  return String(text)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

export function buildSlug(titulo: string, ref: string): string {
  const base = slugify(titulo);
  const refPart = String(ref).toLowerCase();
  return base ? `${base}-${refPart}` : refPart;
}
