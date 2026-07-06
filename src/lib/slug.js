// Replica exacta de web/lib/slug.ts (buildSlug): mismo algoritmo, mismo
// resultado, para que el link que arma el bot coincida con la ruta real
// que sirve la landing (/propiedades/[slug]).

function slugify(text) {
  return String(text)
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // sin tildes (marcas diacriticas combinantes)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // todo lo demas (emojis incluidos) a guion
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

function buildSlug(titulo, ref) {
  const base = slugify(titulo);
  const refPart = String(ref).toLowerCase();
  return base ? `${base}-${refPart}` : refPart;
}

module.exports = { buildSlug };
