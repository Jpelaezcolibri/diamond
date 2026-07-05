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

module.exports = { detectSellerIntent };
