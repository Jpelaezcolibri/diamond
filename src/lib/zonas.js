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

function zonaTokens(zona) {
  return String(zona)
    .toLowerCase()
    .split(/[^a-záéíóúñü]+/i)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
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

// Sin tildes, para comparar. `zonaTokens` las CONSERVA ("Belen" y "Belén" dan
// tokens distintos), asi que el mapa se normaliza en las dos puntas: sin esto,
// media tabla de vecindad no matcheaba nunca y fallaba en silencio — que es
// exactamente el tipo de bug que este modulo existe para evitar.
function sinTildes(t) {
  return String(t).normalize("NFD").replace(/\p{M}/gu, "");
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

module.exports = { STOPWORDS, GENERIC_GEO, zonaTokens, distinctiveTokens, sonVecinas, vecinosDe, VECINDAD };
