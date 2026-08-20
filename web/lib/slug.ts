/**
 * Slug SEO derivado: slugify(titulo)-ref. Sin columna en BD, sin
 * desincronizacion con titulos que el sync de Wasi actualiza.
 * El ref al final es la clave real de lookup (patron Stack Overflow):
 * si el titulo cambia, el slug viejo redirige 301 al canonico.
 */

// BUG real (Juan, 2026-08-20): el corte a los 60 caracteres caia a mitad de
// palabra ("...carretera-Principal" -> "...carretera-pr", ref 9100417, lote
// en Llanogrande). Cortar en el limite de palabra completa, nunca a mitad,
// es mas resistente a que el bot y esta landing calculen el slug con un
// titulo levemente distinto (espacios, timing del sync) y corten en un punto
// distinto — ver la nota completa en src/lib/slug.js (repo del bot), que
// tiene que seguir siendo un espejo exacto de este archivo.
function slugify(text: string): string {
  const base = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // sin tildes (marcas diacriticas combinantes)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // todo lo demas (emojis incluidos) a guion
    .replace(/^-+|-+$/g, "");

  if (base.length <= 60) return base;

  const cortado = base.slice(0, 60);
  const ultimoGuion = cortado.lastIndexOf("-");
  const limpio = ultimoGuion > 10 ? cortado.slice(0, ultimoGuion) : cortado;
  return limpio.replace(/-+$/, "");
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
