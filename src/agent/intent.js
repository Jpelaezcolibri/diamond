// Deteccion deterministica de la intencion del cliente a partir de su mensaje.
// No sustituye al modelo: es el piso de confiabilidad. Una frase explicita como
// "quiero vender mi apartamento" fija el encuadre correcto para el asesor aunque
// el modelo no registre la intencion por su cuenta. Solo dispara con senales de
// ALTA precision (el cliente hablando de vender SU inmueble), para no confundir
// a un comprador que menciona "venta" de pasada.
const SELLER_RE =
  /\b(quiero|deseo|necesito|quisiera|me gustar[ií]a|estoy\s+buscando|busco)\s+(vender|consignar)\b|\b(vender|vendo|consignar|consigno)\s+(mi|mis|nuestr[ao]s?)\b|\bpon(er|go|dr[ée])\s+en\s+venta\s+(mi|mis|nuestr[ao]s?)\b|\bmi\s+(propiedad|casa|apartamento|apto|inmueble|finca|lote|local)\b[^.?!]{0,40}\b(vender|venta|consignar)\b/i;

// Devuelve "vender" si el mensaje expresa intencion de vender el propio inmueble.
function detectSellerIntent(text) {
  return SELLER_RE.test(String(text || "")) ? "vender" : null;
}

// Dueno que quiere ARRENDAR su propio inmueble (2026-10-16, spec kit +
// duenos para arriendo). Antes no existia: "quiero arrendar mi apto" caia en
// tools.js como `arrendar` (inquilino) y Sofi le ofrecia inventario a un
// propietario. Mismo criterio que SELLER_RE: solo frases de ALTA precision,
// con el posesivo ("mi", "mis") o "tengo un ... para arrendar". "busco
// arrendar un apto" es un inquilino y no dispara.
const INMUEBLE = "(propiedad|casa|apartamento|apto|apartaestudio|inmueble|finca|local|oficina)s?";
const OWNER_RENT_RE = new RegExp(
  [
    String.raw`\b(arrendar|rentar|alquilar|arriendo|alquilo|rento)\s+(mi|mis|nuestr[ao]s?)\s+(?!primer)${INMUEBLE}\b(?!\s+(?:ideal|so[ñn]ad[oa]))`,
    String.raw`\bpon(er|go|dr[ée])\s+(en\s+(arriendo|renta|alquiler)\s+(mi|mis|nuestr[ao]s?)|(mi|mis|nuestr[ao]s?)\s+${INMUEBLE}\s+en\s+(arriendo|renta|alquiler|airbnb))\b`,
    String.raw`\btengo\s+(un|una)\s+${INMUEBLE}\s+para\s+(arrendar|rentar|alquilar|arriendo|renta)\b`,
    String.raw`\bmi\s+${INMUEBLE}\b(?:(?!\b(?:busco|buscando|necesito)\b)[^.?!]){0,40}\b(?:(?:arrendar|rentar|alquilar)(?!\s+(?:un|una|uno|algo|otro|otra)\b)|arriendo|airbnb)\b`,
    String.raw`\b(administran|manejan|reciben)\s+(arriendos|propiedades\s+para\s+arriendo|inmuebles\s+para\s+arrendar)\b`,
  ].join("|"),
  "i"
);

// Devuelve "consignar_arriendo" si el mensaje expresa intencion de arrendar el
// propio inmueble (arriendo mensual o renta corta).
function detectOwnerRentIntent(text) {
  return OWNER_RENT_RE.test(String(text || "")) ? "consignar_arriendo" : null;
}

// Decision por TURNO (2026-10-16, revision final): se mira solo el mensaje
// ACTUAL, no el historial. Con el historial, si Sofi corregia a un inquilino
// mal etiquetado (registrar_dato_lead intencion=arrendar), el turno siguiente
// lo volvia a voltear a dueno. Mismo blindaje: no asesor, no colega, vender
// gana, y no se repite si ya es consignar_arriendo.
function intencionDeDuenoEnTurno({ text, lead, advisor = null, colega = null }) {
  if (advisor || colega) return null;
  if (["vender", "consignar_arriendo"].includes(lead && lead.intencion)) return null;
  if (detectSellerIntent(text)) return null;
  return detectOwnerRentIntent(text);
}

// ── Idioma del cliente ──────────────────────────────────────────────────────
// Senal fuerte: los prellenados EN de la landing traducida (son NUESTROS, los
// conocemos exactos — ver web/config/tenants/*.ts). Señal debil: heuristica
// lexica para quien escribe organicamente en ingles. Conservadora a proposito:
// cualquier señal española gana y devuelve null (español por defecto) — un
// falso "en" es peor que atender en español a un angloparlante que ya nos
// escribio y puede pedir "in English please".
const EN_PREFILL_RES = [
  /^hi,?\s+i'?m interested in propert/i,
  /^hi,?\s+i'?d like information about your propert/i,
  /^hi,?\s+i want to sell my propert/i,
];
const ES_HINTS_RE =
  /[¿¡]|\b(hola|buenas|buenos dias|quiero|quisiera|busco|necesito|me interesa|informaci[oó]n|apartamento|apto|arriendo|arrendar|alquiler|comprar|venta|vender|casa|finca|propiedad|inmueble|precio|cu[aá]nto|gracias|por favor|habitaciones|d[ií]as|tienes?|tienen)\b/i;
const EN_HINTS_RE =
  /\b(hi|hello|hey|good (morning|afternoon|evening)|i'?m looking|looking for|apartment|house|for (rent|sale)|to (rent|buy)|do you have|i want|i('| a)?m interested|i would like|i'?d like|available|bedrooms?|price|how much|please)\b/i;

// Devuelve "en" si el PRIMER mensaje viene en ingles; null = español (default).
function detectClientLanguage(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  if (EN_PREFILL_RES.some((re) => re.test(t))) return "en";
  if (ES_HINTS_RE.test(t)) return null;
  if (t.length >= 8 && EN_HINTS_RE.test(t)) return "en";
  return null;
}

module.exports = { detectSellerIntent, detectOwnerRentIntent, intencionDeDuenoEnTurno, detectClientLanguage };
