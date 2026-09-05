// Este archivo tambien viaja al navegador (epe/): sin node:*, sin Supabase,
// sin process.env. Lo custodia test/prefilter-puro.test.js.
// Tokenizacion de zonas — puro, sin dependencias.
//
// Vive aparte de src/data/properties.js para que el prefiltro de grupos tenga
// un cierre de dependencias limpio: properties.js arrastra el cliente de
// Supabase, la config y el seed en memoria, y el prefiltro tiene que poder
// correr DENTRO del navegador del asesor (extension de Chrome), donde nada de
// eso existe.
//
// properties.js sigue re-exportando estas cuatro cosas: src/groups/match.js las
// usa como `properties.zonaTokens(...)`, asi que quitarlas de ahi seria un
// TypeError diferido — el peor tipo, porque no falla al cargar sino al primer
// cruce real.

// Palabras utiles de una zona de busqueda: fuera articulos y conectores,
// para que "El Poblado" encuentre "Poblado" y "Loma del Chocho" encuentre "Chocho"
const STOPWORDS = new Set(["el", "la", "los", "las", "de", "del", "en", "sector", "barrio", "zona"]);

// Palabras geograficas GENERICAS: describen un tipo de accidente o urbanizacion,
// no identifican una zona concreta. En Medellin hay decenas de "lomas" (Loma del
// Indio en El Poblado, Loma del Chocho en Envigado, Loma de los Balsos...): un
// match solo por "loma" es un falso positivo que ubica al cliente en el sitio
// equivocado. Si el query trae ademas un nombre distintivo, estas no cuentan
// como coincidencia por si solas.
// BUG real (Juan, 2026-08-20): "san"/"santa"/"santo" no estaban en esta lista.
// "Loma de San Julián" (El Poblado) matcheaba "exacta" contra "San Joaquín,
// Laureles" y contra "Tierra Firme San Germán" — dos barrios sin ninguna
// relacion, solo porque los tres comparten el token "san". Se publico en vivo
// (pedido de Catalina, "PEDIDOS 7:00A.M.8:00P.M.", 2026-08-20) antes de
// notarse: 2 de las 3 propiedades ofrecidas no tenian nada que ver con lo
// pedido. Mismo defecto que "loma" en julio, solo que con un prefijo distinto
// — en Medellin/Antioquia "San/Santa/Santo X" es tan comun como "Loma X".
const GENERIC_GEO = new Set([
  "loma", "lomas", "alto", "altos", "bajo", "bajos", "vereda", "parcelacion",
  "conjunto", "urbanizacion", "unidad", "ciudadela", "cerro", "parque", "via",
  "san", "santa", "santo",
]);

// SIN TILDES, EN LAS DOS PUNTAS (auditoria 2026-09-05). Hasta hoy los tokens
// conservaban la tilde y la comparacion exacta de zonaCoincide era sensible a
// ella. Medido contra produccion: el inventario guarda "Belén", "Itagüi",
// "Velódromo", "La América"; los colegas piden "Belén" (25 pedidos en 10
// dias), "Itagüí" (12), "Belen", "Itagui". Con "Itagüí" el prefiltro SQL
// (ilike '%itagüí%') traia CERO filas porque la base dice "Itagüi"; con
// "Belen" traia 3 de 6. Un tokenizador que distingue "belen" de "belén" no
// distingue barrios, distingue teclados.
//
// La ñ tambien se aplana: los tokens son SOLO para comparar y para armar el
// patron de la consulta (ver patronSinTildes), nunca se muestran, y "Zúñiga"
// se pide como "Zuñiga" y como "Zuniga".
const ACENTOS = {
  á: "a", à: "a", ä: "a", â: "a",
  é: "e", è: "e", ë: "e", ê: "e",
  í: "i", ì: "i", ï: "i", î: "i",
  ó: "o", ò: "o", ö: "o", ô: "o",
  ú: "u", ù: "u", ü: "u", û: "u",
  ñ: "n",
};

function sinAcentos(t) {
  return String(t)
    .toLowerCase()
    .replace(/[áàäâéèëêíìïîóòöôúùüûñ]/g, (c) => ACENTOS[c] || c);
}

function zonaTokens(zona) {
  return sinAcentos(zona)
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

// El patron para la consulta SQL: la base NO tiene unaccent, y un ilike con
// el token aplanado ('%belen%') no encuentra "Belén". Cada vocal y la n se
// vuelven una clase que acepta todas sus variantes, y se consulta con imatch
// (regex, sin distinguir mayusculas): "belen" -> "b[eéèëê]l[eéèëê][nñ]"
// encuentra "Belén", "Belen Rosales" y "BELEN". Los tokens son letras a-z
// (zonaTokens ya aplano y partio), asi que no hay nada que escapar.
const CLASE = { a: "[aáàäâ]", e: "[eéèëê]", i: "[iíìïî]", o: "[oóòöô]", u: "[uúùüû]", n: "[nñ]" };

function patronSinTildes(token) {
  return sinAcentos(token).replace(/[a-z]/g, (c) => CLASE[c] || c);
}

// Tokens que SI identifican la zona. Si hay alguno distintivo (no generico), el
// match exige uno de esos; los genericos ("loma") no bastan. Si TODOS son
// genericos, se usan tal cual como ultimo recurso.
function distinctiveTokens(tokens) {
  const distinctive = tokens.filter((t) => !GENERIC_GEO.has(t));
  return distinctive.length > 0 ? distinctive : tokens;
}

// ── Vecindad entre zonas ─────────────────────────────────────────────────
//
// Quien pide "El Poblado" muchas veces compra en Envigado: son contiguos y el
// mismo cliente se mueve entre los dos. Tratar la zona como compuerta binaria
// hacia perder ese negocio — y era justo lo que pasaba.
//
// OJO CON LA LECCION DE JULIO. La comparacion laxa produjo 656 de 731 falsos
// positivos, pero por dos causas distintas de esta: comparar por SUBSTRING
// ("laurel" de Sabaneta cayendo dentro de "laureles") y el fallback a la ciudad
// ENTERA. Ninguna de las dos se toca. Lo que se agrega es vecindad explicita
// entre zonas nombradas, que es informacion geografica real, no laxitud.
//
// Es un punto de partida escrito por alguien que no vive en Medellin: si un
// vecindario esta mal, se corrige aca y el efecto es inmediato. La relacion se
// declara UNA vez y se lee en los dos sentidos.
const VECINDAD = [
  // Corredor sur: el cliente de El Poblado mira Envigado y Sabaneta.
  ["poblado", "envigado"],
  ["poblado", "sabaneta"],
  ["envigado", "sabaneta"],
  ["sabaneta", "itagui"],
  ["envigado", "itagui"],
  ["sabaneta", "estrella"],
  ["itagui", "estrella"],
  // Lomas y sectores que son parte de El Poblado o de su borde con Envigado.
  ["poblado", "balsos"], ["poblado", "indio"], ["poblado", "palmas"],
  ["poblado", "castropol"], ["poblado", "manila"], ["poblado", "provenza"],
  ["envigado", "escobero"], ["envigado", "chocho"], ["envigado", "zuniga"],
  ["poblado", "rio"],
  // Corredor occidental: Laureles y su entorno inmediato.
  ["laureles", "estadio"], ["laureles", "conquistadores"], ["laureles", "velodromo"],
  ["laureles", "america"], ["laureles", "joaquin"], ["laureles", "bolivariana"],
  ["laureles", "colores"], ["laureles", "calasanz"], ["laureles", "bolivar"],
  ["america", "calasanz"], ["america", "colores"],
  // Belen y su borde con Laureles y Guayabal.
  ["belen", "laureles"], ["belen", "guayabal"], ["belen", "mota"],
  ["belen", "rosales"], ["belen", "rodeo"], ["guayabal", "rio"],
  // Centro.
  ["centro", "boston"], ["centro", "prado"], ["boston", "buenos"],
  // Oriente cercano: otro mercado, pero el cliente de finca los mira juntos.
  ["rionegro", "llanogrande"], ["rionegro", "ceja"], ["llanogrande", "ceja"],
  ["rionegro", "retiro"], ["llanogrande", "retiro"],
];

// Sin tildes, para comparar. Desde el 2026-09-05 `zonaTokens` ya las aplana
// (ver sinAcentos arriba), asi que esto es un cinturon para tokens que
// lleguen de otro lado; antes era lo unico que hacia que la tabla de vecindad
// matcheara, porque los tokens conservaban la tilde.
function sinTildes(t) {
  return sinAcentos(t);
}

// token -> Set de tokens vecinos. Se arma una vez al cargar el modulo.
const VECINOS = new Map();
for (const [a0, b0] of VECINDAD) {
  const a = sinTildes(a0);
  const b = sinTildes(b0);
  if (!VECINOS.has(a)) VECINOS.set(a, new Set());
  if (!VECINOS.has(b)) VECINOS.set(b, new Set());
  VECINOS.get(a).add(b);
  VECINOS.get(b).add(a);
}

// ¿Alguno de los tokens pedidos es vecino de alguno de los de la propiedad?
// No es transitivo a proposito: Poblado es vecino de Sabaneta y Sabaneta de La
// Estrella, pero El Poblado y La Estrella no son lo mismo ni de cerca. Si la
// vecindad se encadenara, en dos saltos todo Medellin seria vecino de todo.
// Los tokens vecinos de lo pedido. Sirve para AMPLIAR la consulta SQL: si solo
// se traen las propiedades de la zona pedida, las vecinas nunca llegan al motor
// y la graduacion no puede evaluarlas. Un salto, nunca transitivo.
function vecinosDe(tokensPedido) {
  const out = new Set();
  for (const t of tokensPedido || []) {
    const vecinos = VECINOS.get(sinTildes(t));
    if (vecinos) for (const v of vecinos) out.add(v);
  }
  return [...out];
}

function sonVecinas(tokensPedido, tokensPropiedad) {
  const dela = new Set((tokensPropiedad || []).map(sinTildes));
  for (const t0 of tokensPedido || []) {
    const vecinos = VECINOS.get(sinTildes(t0));
    if (!vecinos) continue;
    for (const v of vecinos) if (dela.has(v)) return true;
  }
  return false;
}

// ── Sub-zonas: contencion, no vecindad ───────────────────────────────────
//
// Distinto de VECINDAD (dos sectores contiguos, pero cada uno es el suyo):
// aca un sector es LITERALMENTE parte del otro. Quien pide "Laureles" y una
// propiedad esta en "San Joaquin" no esta mirando el barrio de al lado, esta
// mirando exactamente lo que pidio.
//
// Evidencia real (Juan, 2026-08-20 — auditoria del veredicto de Sofi en modo
// asistido, dos pedidos distintos): "San Joaquin es parte de Laureles" y
// "[Rodeo Alto] estan dentro de Belen, no son 'vecinas' sino que estan EN la
// zona pedida" — el motor las calificaba como 'vecina' (grado mas debil,
// -5 puntos) cuando deberian ser 'exacta' (+20). La contencion no es
// simetrica: Laureles no es una sub-zona de San Joaquin, por eso el mapa va
// en un solo sentido (subzona -> zona madre) y se consulta solo desde el
// lado de la propiedad.
const SUBZONA_DE = new Map([
  ["joaquin", "laureles"], // San Joaquin
  ["rodeo", "belen"], // Rodeo Alto / Rodeo Bajo
  // Juan, 2026-08-21 (caso Alberto Posada, pedido codigo 629): "las palmas se
  // puede tomar como poblado, hace parte de El Poblado" — quien pide El
  // Poblado y una propiedad esta en Las Palmas no esta mirando el sector de
  // al lado, esta mirando lo que pidio. Antes calificaba 'vecina' (-5, sin
  // publicar por puntaje_bajo); ahora 'exacta' (+20). La entrada en VECINDAD
  // (linea de arriba en este archivo) se conserva a proposito: es la que
  // hace que el prefiltro SQL siquiera traiga Las Palmas cuando se busca
  // Poblado — sin ella esta subzona nunca llegaria al motor para evaluarse.
  ["palmas", "poblado"],
]);

// ¿Algun token de la propiedad es una sub-zona conocida de algun token
// pedido? Mismo criterio de token exacto que el resto del archivo — nunca
// substring.
function subzonaCoincide(tokensPedido, tokensPropiedad) {
  const pedidos = new Set((tokensPedido || []).map(sinTildes));
  for (const t of tokensPropiedad || []) {
    const madre = SUBZONA_DE.get(sinTildes(t));
    if (madre && pedidos.has(madre)) return true;
  }
  return false;
}

module.exports = {
  STOPWORDS, GENERIC_GEO, zonaTokens, distinctiveTokens, sonVecinas, vecinosDe, subzonaCoincide, VECINDAD, SUBZONA_DE,
  sinAcentos, patronSinTildes,
};
