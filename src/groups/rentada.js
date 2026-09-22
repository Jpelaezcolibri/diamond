// Si un pedido exige que la propiedad ya este rentando, y si la ficha lo dice.
//
// LA REGLA (Juan, 2026-09-22): "cuando no se tenga claridad si esta alquilado
// o no, callar para no incomodar a los colegas". El caso: "APTO, CASA O LOCAL
// para inversion que este rentando entre 6 a 7 millones ... Laureles" recibio
// por DM tres apartamentos cuyas fichas no dicen nada de arriendo, y el colega
// contesto "¿esos apartamentos se acomodan con algun pedido que hice?".
//
// POR QUE DEL TEXTO Y NO DEL CLASIFICADOR: el prompt del clasificador esta
// cacheado (src/groups/classify.js) y agregarle un campo cambia el prefijo de
// ~1.000 llamadas diarias. La exigencia es rara (3 de 1.000 pedidos del ultimo
// mes, medido 2026-09-22) y su forma es muy regular, asi que se lee con
// patrones, igual que el piso (./piso.js) y el amoblado (./amoblado.js).
//
// Wasi tampoco tiene un campo "arrendado": el dato vive en la descripcion
// cuando vive ("Propiedad actualmente rentando por Airbnb", ref 9771031).
//
// Modulo hoja a proposito: lo llama match.js por cada candidata de cada
// pedido, asi que no puede tener I/O ni dependencias.

function normalizar(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// LO QUE SOLO PERMITE, que se borra ANTES de buscar la exigencia. Son 4 de
// los 7 pedidos reales del mes: "puede estar arrendado", "puede estar
// alquilado", "(arrendada o desocupada)". Leerlos como exigencia callaria
// pedidos que si se pueden responder.
const PERMITE = [
  /\b(puede|pueda|podria|no importa si|sirve|acepta)\s+(que\s+)?(estar\s+|este\s+)?(rentando|arrendad\w*|alquilad\w*)/g,
  /\b(arrendad\w*|alquilad\w*|rentando)\s+o\s+(no|desocupad\w*|vaci\w*|sin\s+arrendar)\b/g,
  /\b(desocupad\w*|vaci\w*)\s+o\s+(arrendad\w*|alquilad\w*|rentando)\b/g,
];

// LO QUE EXIGE. "Rentar"/"arrendar" en infinitivo ("que se pueda arrendar",
// "para rentas cortas") no esta aca a proposito: habla de lo que se podria
// hacer con la propiedad, no de lo que pasa hoy.
const EXIGE = [
  /\b(que\s+)?(ya\s+)?(este|esta)\s+(rentando|arrendad[oa]|alquilad[oa]|produciendo)\b/,
  /\brentando\s+(entre|en|por|al\s+mes|mas\s+de|minimo|\$|\d)/,
  /\b(actualmente|ya)\s+(rentando|arrendad[oa]|alquilad[oa])\b/,
  /\b(arrendad[oa]|alquilad[oa])\s+(actualmente|en\s+\$?\s?\d|por\s+\$?\s?\d)/,
  /\b(con|tenga)\s+(inquilino|arrendatario|contrato\s+de\s+arr\w*|renta\s+activa|rentas\s+activas)\b/,
  /\bno\s+quiere\s+desocupad/,
  /\bque\s+produzca\s+renta\b/,
];

/**
 * ¿El pedido exige que la propiedad ya este rentando? Solo en venta: en un
 * pedido de arriendo "alquilado" significa otra cosa.
 *
 * Lee el mensaje en vivo (`c.mensaje.texto`) y, si no viene, el texto
 * guardado de la señal (`c.texto_original`, lo que usa recalcular).
 */
function exigeRentada(c) {
  if (!c || !String(c.operacion || "").toLowerCase().includes("venta")) return false;
  let texto = normalizar((c.mensaje && c.mensaje.texto) || c.texto_original);
  if (!texto.trim()) return false;
  for (const rx of PERMITE) texto = texto.replace(rx, " ");
  return EXIGE.some((rx) => rx.test(texto));
}

const RENTA_HOY = [
  /\b(actualmente|hoy)\s+(esta\s+|se\s+encuentra\s+)?(rentando|arrendad[oa]|alquilad[oa])\b/,
  /\b(esta|se\s+encuentra)\s+(rentando|arrendad[oa]|alquilad[oa])\b/,
  /\b(con|tiene)\s+(inquilino|arrendatario|contrato\s+de\s+arr\w*\s+vigente|contrato\s+vigente)\b/,
  /\bse\s+vende\s+(con\s+)?(inquilino|arrendad[oa]|rentando)\b/,
  /\brenta\s+actual\b|\bgenerando\s+(renta|ingresos)\b/,
];
const VACIA = [/\bpara\s+estrenar\b/, /\bdesocupad[oa]\b/, /\bsin\s+inquilino/, /\bnunca\s+habitad/];

/**
 * @returns true  si la ficha dice que hoy esta rentando
 *          false si dice que esta vacia o es para estrenar
 *          null  si no se puede saber
 *
 * `null` NO es `false`: ante un pedido que exige renta, `false` descarta la
 * candidata y `null` la deja pasar marcada `rentada_sin_confirmar`, que es lo
 * que la calla ante el colega sin sacarla del panel.
 */
function estaRentada(propiedad) {
  if (!propiedad) return null;
  const texto = normalizar(
    [propiedad.titulo, propiedad.descripcion, propiedad.caracteristicas]
      .filter(Boolean)
      .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
      .join(" ")
      .replace(/<[^>]*>/g, " ")
  );
  if (!texto.trim()) return null;
  // El positivo primero: "se vende con inquilino ... entrega desocupado a
  // los 6 meses" renta HOY, que es lo que pidio el colega.
  if (RENTA_HOY.some((rx) => rx.test(texto))) return true;
  if (VACIA.some((rx) => rx.test(texto))) return false;
  return null;
}

module.exports = { exigeRentada, estaRentada };
