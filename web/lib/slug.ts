/**
 * Slug SEO derivado: slugify(titulo)-ref. Sin columna en BD, sin
 * desincronizacion con titulos que el sync de Wasi actualiza.
 * El ref al final es la clave real de lookup (patron Stack Overflow):
 * si el titulo cambia, el slug viejo redirige 301 al canonico.
 */

function slugify(text: string): string {
  return text
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
  const refPart = ref.toLowerCase();
  return base ? `${base}-${refPart}` : refPart;
}

/** El ref es el ultimo segmento del slug (los refs no contienen guiones). */
export function refFromSlug(slug: string): string {
  return slug.split("-").pop() ?? slug;
}
