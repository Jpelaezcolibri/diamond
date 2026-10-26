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
//
// "EN LAS PALMAS" Y "POBLADO-PALMAS" (segunda revision del DM amplio, N1,
// 2026-10-26). La 9856842 dice "CASA DE LUJO EN VENTA EN LAS PALMAS – SECTOR
// COUNTRY CLUB" y la 10447697 "Apartamento en el Poblado-Palmas": ninguna
// trae un INTRO delante de "palmas", asi que graduaban `zona_general` y
// salian con "el barrio exacto no lo tengo registrado", que es falso. Un
// nombre de UNA palabra que no es de todos los dias (PALABRAS_COMUNES) tambien
// cuenta despues de "en" o pegado a la zona registrada de la ficha. "en la
// mesa", "en el tesoro" siguen sin contar.
function patronesDe(ks, p) {
  const patrones = [patronDe(ks)];
  if (ks.length !== 1 || PALABRAS_COMUNES.has(ks[0])) return patrones;
  patrones.push(` en(?: (?:el|la|los|las))? ${ks[0]}\\b`);
  for (const z of claves(String(p.zona || ""))) {
    if (z !== ks[0]) patrones.push(` ${z} ${ks[0]}\\b`);
  }
  return patrones;
}

function nombra(p, sector) {
  const ks = claves(sector);
  if (!ks.length) return false;
  const texto = textoDe(p);
  return patronesDe(ks, p).some((patron) => aparece(texto, patron));
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

// ¿LA FICHA DICE DONDE QUEDA? (revision final del rescate, 2026-10-20).
// otrosBarrios es angosto a proposito porque DESCARTA: exige que un INTRO
// presente el nombre y no cuenta "via las Antillas". Esta otra pregunta es la
// de publicable.js para decidir si `sector_sin_confirmar` es un dato que de
// verdad no tenemos: si el titulo o la descripcion nombran un barrio conocido
// del municipio que el pedido NO pidio, el barrio no es "desconocido" y la
// ficha no puede salir con "el barrio exacto no lo tengo registrado".
// Casos: 10031500 "Sector Campestre Via las Antillas Envigado" para un pedido
// de Dorado o La Paz; 8989725 "Apartamento Moderno Poblado Palmas" para un
// pedido de San Lucas o Zuniga. Aca no importa la cercania (si la ficha se
// ubica por otro barrio, ya no es un dato que falta) y solo las palabras de
// todos los dias siguen pidiendo un INTRO ("barrio La Paz", no "paz").
const PALABRAS_COMUNES = new Set([
  "paz", "dorado", "mesa", "oasis", "brujas", "atravesado", "cuenca", "portal", "salado", "magnolia",
  "tesoro", "bonito", "linde", "lucas", "indio", "parra", "carlota", "lorena", "castellana", "milan",
  "abadia", "marcos", "cumbres", "rodeo",
]);

// "SECTOR X" TAMBIEN DICE DONDE QUEDA (segunda revision del DM amplio, N1,
// 2026-10-26). La 10410315 dice "Apartamento remodelado poblado sector
// campestre"; "campestre" no es hija de El Poblado en SUBZONA_DE, asi que no
// se detectaba y un pedido de Las Palmas/Balsos/San Lucas la recibia con "el
// barrio exacto no lo tengo registrado". Si ningun barrio conocido aparece,
// el nombre que presenta "sector"/"barrio"/"urbanizacion" cuenta como el
// lugar de la ficha, salvo que sea lo pedido, la zona misma o una palabra de
// las que acompanan a "sector" sin nombrar nada ("sector tranquilo", "sector
// sin pico y placa", "urbanizacion privada"). Equivocarse aca es el lado
// seguro: la ficha no sale con "no lo tengo registrado" y queda con la
// asesora (o como zona cercana).
const NO_ES_LUGAR = new Set([
  "tranquilo", "tranquila", "residencial", "exclusivo", "exclusiva", "comercial", "privilegiado", "privilegiada",
  "sin", "con", "muy", "seguro", "segura", "central", "centrico", "centrica", "estrategico", "estrategica",
  "cerrado", "cerrada", "privado", "privada", "familiar", "valorizado", "valorizada", "valorizacion", "alta", "alto",
  "excelente", "reconocido", "reconocida", "popular", "cercano", "cercana", "mas", "que", "donde", "ideal",
  "hermoso", "hermosa", "agradable", "unico", "unica", "apetecido", "apetecida", "consolidado", "consolidada",
  "nuevo", "nueva", "moderno", "moderna", "estrato", "bonito", "bonita", "precioso", "preciosa", "lindo", "linda",
  "silencioso", "silenciosa", "comodo", "comoda", "verde", "verdes", "norte", "sur", "oriente", "occidente",
  "completa", "completo", "campestres", "como", "para", "por", "este", "esta", "ese", "esa", "excepcional",
]);
const LUGAR = / (?:sector|barrio|urbanizacion|urb)(?: (?:el|la|los|las|de|del)){0,2} ([a-z]{4,})( club)?\b/g;

function lugaresNombrados(p, pedidos) {
  const propios = new Set([...claves(String(p.zona || "")), ...claves(String(p.ciudad || ""))]);
  const texto = textoDe(p);
  const vistos = [];
  for (let m = LUGAR.exec(texto); m; m = LUGAR.exec(texto)) {
    const nombre = m[1];
    if (NO_ES_LUGAR.has(nombre) || DESCRIPTIVAS.has(nombre) || pedidos.has(nombre) || propios.has(nombre)) continue;
    const lugar = `${nombre}${m[2] || ""}`;
    if (!vistos.includes(lugar)) vistos.push(lugar);
  }
  LUGAR.lastIndex = 0;
  return vistos;
}

function mencionaOtroBarrio(p, sectoresPedidos = []) {
  const ubic = String(p.zona || "").trim() || String(p.ciudad || "").trim();
  const hijas = zonas.hijasDe(zonas.zonaTokens(ubic));
  if (!hijas.length) return [];
  const pedidos = new Set(sectoresPedidos.flatMap(claves));
  const texto = textoDe(p);
  const conocidos = hijas.filter((h) => {
    if (pedidos.has(h)) return false;
    const patron = PALABRAS_COMUNES.has(h) ? ` ${INTRO} ${h}\\b` : ` ${h}\\b`;
    return new RegExp(patron).test(texto);
  });
  return conocidos.length ? conocidos : lugaresNombrados(p, pedidos);
}

module.exports = { nombra, otrosBarrios, mencionaOtroBarrio, normalizar };
