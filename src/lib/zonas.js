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
const GENERIC_GEO = new Set([
  "loma", "lomas", "alto", "altos", "bajo", "bajos", "vereda", "parcelacion",
  "conjunto", "urbanizacion", "unidad", "ciudadela", "cerro", "parque", "via",
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

module.exports = { STOPWORDS, GENERIC_GEO, zonaTokens, distinctiveTokens };
