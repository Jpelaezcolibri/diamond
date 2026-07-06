const supabase = require("./supabase");
const memory = require("./memory");
const config = require("../config");
const { buildSlug } = require("../lib/slug");

// El "link" que ve el cliente (ficha de Sofi, mensaje al asesor) debe ser
// SIEMPRE el de la landing propia, nunca el de Wasi/inmo.co (que trae la
// columna `link` tal cual desde el sync) — evita mandar trafico y marca a
// un dominio de terceros. Mismo algoritmo de slug que web/lib/slug.ts.
function withLandingLink(p) {
  if (!p) return p;
  return { ...p, link: `${config.landingBaseUrl}/propiedades/${buildSlug(p.titulo, p.ref)}` };
}

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

function matchesFilters(p, f) {
  if (f.ref && p.ref.toUpperCase() !== f.ref.toUpperCase()) return false;
  if (f.zona) {
    const haystack = `${p.zona} ${p.ciudad}`.toLowerCase();
    const tokens = distinctiveTokens(zonaTokens(f.zona));
    if (tokens.length > 0 && !tokens.some((t) => haystack.includes(t))) return false;
  }
  if (f.tipo && !p.tipo.toLowerCase().includes(f.tipo.toLowerCase())) return false;
  if (f.habitaciones_min && p.habitaciones < f.habitaciones_min) return false;
  if (f.precio_max) {
    const precio = parseInt(String(p.precio).replace(/\D/g, ""), 10);
    if (precio && precio > f.precio_max) return false;
  }
  return true;
}

// Busca propiedades disponibles de la org. filters: {ref, zona, tipo, precio_max, habitaciones_min}
async function search(orgId, filters = {}, limit = 5) {
  if (!supabase) {
    return memory.properties
      .filter((p) => p.org_id === orgId && p.disponible && matchesFilters(p, filters))
      .slice(0, limit)
      .map(withLandingLink);
  }
  let query = supabase.from("properties").select("*").eq("org_id", orgId).eq("disponible", true);
  if (filters.ref) query = query.ilike("ref", filters.ref);
  if (filters.zona) {
    const tokens = distinctiveTokens(zonaTokens(filters.zona));
    if (tokens.length > 0) {
      const ors = tokens.flatMap((t) => [`zona.ilike.%${t}%`, `ciudad.ilike.%${t}%`]);
      query = query.or(ors.join(","));
    }
  }
  if (filters.tipo) query = query.ilike("tipo", `%${filters.tipo}%`);
  if (filters.habitaciones_min) query = query.gte("habitaciones", filters.habitaciones_min);
  const { data, error } = await query.limit(limit * 2);
  if (error) throw error;
  // precio es texto — el filtro de precio se aplica en codigo
  const result = filters.precio_max ? data.filter((p) => matchesFilters(p, { precio_max: filters.precio_max })) : data;
  return result.slice(0, limit).map(withLandingLink);
}

// Busca por referencia exacta, incluidas las no disponibles (para informar que ya no esta)
async function findByRef(orgId, ref) {
  if (!supabase) {
    const found = memory.properties.find((p) => p.org_id === orgId && p.ref.toUpperCase() === ref.toUpperCase()) || null;
    return withLandingLink(found);
  }
  const { data, error } = await supabase
    .from("properties")
    .select("*")
    .eq("org_id", orgId)
    .ilike("ref", ref)
    .maybeSingle();
  if (error) throw error;
  return withLandingLink(data);
}

module.exports = { search, findByRef, matchesFilters, zonaTokens, distinctiveTokens, withLandingLink };
