// En que barrio esta una propiedad, segun el texto de su ficha.
//
// LA REGLA (Juan, 2026-09-21): "si alguien pide envigado se puede enviar todo
// lo de envigado pero si dice envigado barrio mesa solo enviar envigado barrio
// mesa, todo depende del pedido del colega". Este modulo solo se consulta
// cuando el pedido nombro un sector y la propiedad esta registrada con la zona
// general (grado `zona_general` en ./ubicacion.js).
//
// POR QUE DEL TEXTO: Wasi guarda casi siempre la zona general ("Envigado") y el
// barrio lo pone en el titulo — "VENDO APARTAMENTO ENVIGADO BARRIO MESA",
// "SECTOR LA CUENCA ENVIGADO", "SECTOR EL PORTAL". Mismo motivo que ./piso.js.
//
// LOS FALSOS POSITIVOS SON EL RIESGO REAL, y no fallan ruidosamente. Las tres
// familias estan en el inventario (2026-09-21):
//   · LA CERCANIA. La 9776475 dice "Cerca a Laureles" y no esta en Laureles;
//     la 10031500 dice "SECTOR CAMPESTRE VIA LAS ANTILLAS" y no esta en Las
//     Antillas. Lo que viene despues de cerca/via/frente/a N cuadras no cuenta.
//   · LA PALABRA COMUN. "mesa", "portal", "cuenca", "paz" son palabras de todos
//     los dias. Un nombre de UNA palabra solo cuenta si lo presenta "barrio",
//     "sector", "loma del", "urbanizacion", "ubicado en"...
//   · "SECTOR" SUELTO. "Sector sin pico y placa", "sector tranquilo": por eso
//     un barrio DISTINTO solo se detecta si es uno conocido (SUBZONA_DE), nunca
//     por lo que venga despues de "sector".
//
// Modulo hoja, sin I/O: lo llama el motor por cada candidata de cada pedido.

const zonas = require("../lib/zonas");

function normalizar(s) {
  return String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&([aeiou])(?:acute|grave|uml);/gi, "$1")
    .replace(/&(n)tilde;/gi, "$1")
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function textoDe(p) {
  return ` ${normalizar(p.titulo)} ${normalizar(p.descripcion)} `;
}

// Lo que presenta un nombre de lugar. "Unidad"/"edificio" entran porque el
// colega pide "UNIDAD CAMINO DE LAS AGUAS" como si fuera un sector.
const INTRO = "(?:barrio|sector|urbanizacion|urb|loma|ubicad[oa] en|ubicacion|unidad|conjunto|edificio|torre)(?: residencial)?(?: (?:el|la|los|las|de|del)){0,2}";

// Cualquiera de estas palabras en las 4 anteriores al nombre lo vuelve una
// referencia, no una ubicacion.
const CERCANIA = /\b(cerca|via|frente|junto|lado|diagonal|contiguo|saliendo|llegando|pasos|cuadras?|minutos?|min|alrededores|aledan[oa]s?)\b/;

function cercano(texto, indice) {
  const antes = texto.slice(0, indice).trim().split(" ").slice(-4).join(" ");
  return CERCANIA.test(antes);
}

function aparece(texto, patron) {
  const re = new RegExp(patron, "g");
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    if (!cercano(texto, m.index)) return true;
  }
  return false;
}

// Las claves de un nombre: sus tokens distintivos ("Unidad Camino de las
// Aguas" -> camino, aguas; "Barrio Mesa" -> mesa). Mismo criterio que el resto
// del motor.
function claves(nombre) {
  const ks = zonas.distinctiveTokens(zonas.zonaTokens(nombre)).map(normalizar).filter(Boolean);
  // Una descripcion no es un nombre: "Unidad Completa" confirmaba 9 fichas del
  // inventario y "Conjunto Cerrado" 1 (medido 2026-09-21). El prompt del
  // clasificador ya prohibe mandarlas como unidad; esto es por si lo hace.
  return ks.every((k) => DESCRIPTIVAS.has(k)) ? [] : ks;
}

const DESCRIPTIVAS = new Set([
  "unidad", "conjunto", "edificio", "torre", "residencial", "completa", "completo", "cerrada", "cerrado",
  "nueva", "nuevo", "moderna", "moderno", "tranquila", "tranquilo", "club", "privada", "privado",
]);

function patronDe(ks) {
  // Una sola palabra: tiene que presentarla un INTRO. Varias: en orden, con
  // hasta tres palabras de relleno entre cada una ("camino DE LAS aguas").
  if (ks.length === 1) return ` ${INTRO} ${ks[0]}\\b`;
  return ` ${ks.join("(?: [a-z0-9]+){0,3} ")}\\b`;
}

// ¿La ficha dice que la propiedad esta en `sector`?
function nombra(p, sector) {
  const ks = claves(sector);
  if (!ks.length) return false;
  return aparece(textoDe(p), patronDe(ks));
}

// Barrios conocidos del municipio de la propiedad que su ficha nombra y que el
// pedido NO pidio. Solo los de SUBZONA_DE: un barrio desconocido no se puede
// afirmar como "distinto".
function otrosBarrios(p, sectoresPedidos = []) {
  const ubic = String(p.zona || "").trim() || String(p.ciudad || "").trim();
  const hijas = zonas.hijasDe(zonas.zonaTokens(ubic));
  if (!hijas.length) return [];
  const pedidos = new Set(sectoresPedidos.flatMap(claves));
  const texto = textoDe(p);
  return hijas.filter((h) => !pedidos.has(h) && aparece(texto, patronDe([h])));
}

module.exports = { nombra, otrosBarrios, normalizar };
