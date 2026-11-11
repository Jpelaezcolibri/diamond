// La descripción de una ficha de Wasi como texto corrido, para que la lea Sofi
// (Juan, 2026-11-11: "pásale a Sofi la descripción"). Wasi la guarda en HTML
// ("<p>APARTAMENTO…&nbsp;</p><div>Porter&iacute;a…</div>"). Auditoría del
// 11-nov: la revalidación del radar no la recibía y el DM decía "no tengo
// confirmado X" cuando la descripción sí lo decía.

const ENTIDADES = {
  nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  ntilde: "ñ", Ntilde: "Ñ", uuml: "ü", Uuml: "Ü", deg: "°", sup2: "²", ordm: "º", ordf: "ª", iexcl: "¡", iquest: "¿",
};

function descripcionPlana(html, max = 600) {
  if (!html) return null;
  let t = String(html)
    .replace(/<\s*br\s*\/?>/gi, ". ")
    .replace(/<\/\s*(p|div|li|h\d)\s*>/gi, ". ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-zA-Z]+\d?);/g, (m, n) => (n in ENTIDADES ? ENTIDADES[n] : " "))
    .replace(/\s+/g, " ")
    .replace(/(\s*\.\s*){2,}/g, ". ")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .trim();
  if (!t) return null;
  if (t.length > max) t = `${t.slice(0, max).replace(/\s+\S*$/, "")}…`;
  return t;
}

module.exports = { descripcionPlana };
