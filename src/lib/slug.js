// Replica exacta de web/lib/slug.ts (buildSlug): mismo algoritmo, mismo
// resultado, para que el link que arma el bot coincida con la ruta real
// que sirve la landing (/propiedades/[slug]).

// BUG real (Juan, 2026-08-20): el corte a los 60 caracteres caia a mitad de
// palabra ("...carretera-Principal" -> "...carretera-pr", ref 9100417, lote
// en Llanogrande) — el link que Sofi le mando a un colega quedaba con un
// fragmento roto en vez de la palabra completa. El ref sigue siendo el
// ULTIMO segmento (refFromSlug lo extrae por eso), asi que tecnicamente el
// link seguia resolviendo — pero un slug con una palabra a medias es fragil:
// cualquier diferencia minima entre el titulo que uso el bot al armar el
// link y el que la landing lee al recalcularlo (espacios, may/minuscula,
// timing del sync) cambia DONDE cae el corte de 60 caracteres, y eso puede
// producir un slug distinto en las dos puntas. Cortar en el limite de
// palabra completa, nunca a mitad, es mas resistente a esa clase de deriva.
function slugify(text) {
  const base = String(text)
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // sin tildes (marcas diacriticas combinantes)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // todo lo demas (emojis incluidos) a guion
    .replace(/^-+|-+$/g, "");

  if (base.length <= 60) return base;

  const cortado = base.slice(0, 60);
  const ultimoGuion = cortado.lastIndexOf("-");
  // Si el guion queda muy al principio (titulo con una sola palabra gigante),
  // no hay limite de palabra razonable que respetar: se deja el corte crudo.
  const limpio = ultimoGuion > 10 ? cortado.slice(0, ultimoGuion) : cortado;
  return limpio.replace(/-+$/, "");
}

function buildSlug(titulo, ref) {
  const base = slugify(titulo);
  const refPart = String(ref).toLowerCase();
  return base ? `${base}-${refPart}` : refPart;
}

module.exports = { buildSlug };
