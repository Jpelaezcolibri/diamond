// Las descripciones de Wasi vienen con HTML (pegado de editores de texto
// enriquecido): etiquetas <p style=...>, <span>, <strong>, saltos <br>, y
// entidades (&nbsp;, &ntilde;, &aacute;...). La landing las muestra como
// TEXTO, no como HTML, asi que hay que convertirlas a texto plano legible
// preservando los saltos de parrafo. Bug real (2026-07-06): salian los tags
// crudos en "Sobre esta propiedad".

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  ntilde: "ñ", Ntilde: "Ñ", uuml: "ü", Uuml: "Ü",
  ordf: "ª", ordm: "º", iexcl: "¡", iquest: "¿", deg: "°",
  hellip: "…", mdash: "—", ndash: "–", laquo: "«", raquo: "»",
  euro: "€", middot: "·", bull: "•", trade: "™", copy: "©", reg: "®",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) => (name in NAMED_ENTITIES ? NAMED_ENTITIES[name] : m));
}

/**
 * HTML de Wasi -> texto plano legible. Bloques (</p>, <br>, </li>, </div>,
 * </hN>) se vuelven salto de linea; el resto de etiquetas se elimina; las
 * entidades se decodifican; se colapsan espacios y saltos sobrantes.
 */
export function htmlToPlainText(input: string | null | undefined): string | null {
  if (!input) return null;
  let text = input.replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = decodeEntities(text);
  text = text
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}
