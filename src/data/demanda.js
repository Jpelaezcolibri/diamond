// Carga del mapa de demanda (CRM /demanda). El calculo es puro y vive en
// src/groups/mapa-demanda.js; aca solo las dos consultas y la cache.
//
// Una consulta de group_signals del periodo (solo las columnas que usa el
// calculo, paginada de a 1.000 porque PostgREST corta ahi) y una de
// properties. Cache en memoria de 10 minutos por org + periodo + operacion.
const supabase = require("./supabase");
const mapaDemanda = require("../groups/mapa-demanda");

const CACHE_MS = 10 * 60 * 1000;
const PAGINA = 1000;
const TOPE_PAGINAS = 50;

const COLUMNAS_PEDIDO =
  "id, group_id, clase, texto_original, operacion, tipo, zona, zonas, ciudad, precio_min, precio_max, habitaciones, garajes, piso_max, matches, created_at";
const COLUMNAS_PROPIEDAD = "ref, titulo, tipo, operacion, zona, ciudad, precio, disponible, created_at";

const cache = new Map();

async function pedidosDesde(orgId, desdeIso) {
  const out = [];
  for (let i = 0; i < TOPE_PAGINAS; i++) {
    const { data, error } = await supabase
      .from("group_signals")
      .select(COLUMNAS_PEDIDO)
      .eq("org_id", orgId)
      .eq("clase", "demanda")
      .gte("created_at", desdeIso)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(i * PAGINA, (i + 1) * PAGINA - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGINA) break;
  }
  return out;
}

async function propiedadesDe(orgId) {
  const { data, error } = await supabase.from("properties").select(COLUMNAS_PROPIEDAD).eq("org_id", orgId).eq("disponible", true);
  if (error) throw error;
  return data || [];
}

async function mapa(org, { dias = 30, operacion = "venta", ahora = Date.now() } = {}) {
  const clave = `${org.id}|${dias}|${operacion}`;
  const hit = cache.get(clave);
  if (hit && ahora - hit.at < CACHE_MS) return { ...hit.valor, cache: true };
  if (!supabase) throw new Error("El mapa de demanda requiere Supabase");
  // Siempre 90 dias: el calculo filtra el periodo y cuenta 30/90 para el argumento.
  const desde = new Date(ahora - 90 * 86400e3).toISOString();
  const [pedidos, propiedades] = await Promise.all([pedidosDesde(org.id, desde), propiedadesDe(org.id)]);
  const valor = {
    ...mapaDemanda.calcular({
      pedidos,
      propiedades,
      dias,
      operacion,
      orgName: org.name || "",
      comision: process.env.RADAR_LINEA_COMISION || "",
      ahora,
    }),
    generadoAt: new Date(ahora).toISOString(),
  };
  cache.set(clave, { at: ahora, valor });
  return { ...valor, cache: false };
}

function limpiarCache() {
  cache.clear();
}

module.exports = { mapa, limpiarCache, pedidosDesde, propiedadesDe, CACHE_MS };
