const supabase = require("./supabase");
const memory = require("./memory");

// Palabras utiles de una zona de busqueda: fuera articulos y conectores,
// para que "El Poblado" encuentre "Poblado" y "Loma del Chocho" encuentre "Chocho"
const STOPWORDS = new Set(["el", "la", "los", "las", "de", "del", "en", "sector", "barrio", "zona"]);
function zonaTokens(zona) {
  return String(zona)
    .toLowerCase()
    .split(/[^a-záéíóúñü]+/i)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function matchesFilters(p, f) {
  if (f.ref && p.ref.toUpperCase() !== f.ref.toUpperCase()) return false;
  if (f.zona) {
    const haystack = `${p.zona} ${p.ciudad}`.toLowerCase();
    const tokens = zonaTokens(f.zona);
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
      .slice(0, limit);
  }
  let query = supabase.from("properties").select("*").eq("org_id", orgId).eq("disponible", true);
  if (filters.ref) query = query.ilike("ref", filters.ref);
  if (filters.zona) {
    const tokens = zonaTokens(filters.zona);
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
  return result.slice(0, limit);
}

// Busca por referencia exacta, incluidas las no disponibles (para informar que ya no esta)
async function findByRef(orgId, ref) {
  if (!supabase) {
    return memory.properties.find((p) => p.org_id === orgId && p.ref.toUpperCase() === ref.toUpperCase()) || null;
  }
  const { data, error } = await supabase
    .from("properties")
    .select("*")
    .eq("org_id", orgId)
    .ilike("ref", ref)
    .maybeSingle();
  if (error) throw error;
  return data;
}

module.exports = { search, findByRef };
