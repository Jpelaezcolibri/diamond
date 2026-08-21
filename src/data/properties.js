const supabase = require("./supabase");
const memory = require("./memory");
const config = require("../config");
const { buildSlug } = require("../lib/slug");
const formato = require("../lib/formato");

// El "link" que ve el cliente (ficha de Sofi, mensaje al asesor) debe ser
// SIEMPRE el de la landing propia, nunca el de Wasi/inmo.co (que trae la
// columna `link` tal cual desde el sync) — evita mandar trafico y marca a
// un dominio de terceros. Mismo algoritmo de slug que web/lib/slug.ts.
// landingBaseUrl: dominio de la org (organizations.landing_base_url); si no
// se pasa (o la org no lo tiene configurado) cae al env global — asi una org
// nueva sin ese campo aun sigue funcionando, solo con el dominio de Diamond
// por defecto en vez de fallar.
//
// El link que trae el sync de Wasi apunta al dominio propio de la cuenta
// (ej. paraisoinmobiliario.inmo.co). Wasi sirve la MISMA propiedad —mismo
// slug, mismo id— tambien en su dominio generico info.wasi.co (verificado
// 2026-08-19: la misma ruta responde 200 en los dos). Juan pidio publicar ahi
// puntualmente porque info.wasi.co, a diferencia del sitio de cuenta, muestra
// un boton de contacto por WhatsApp con `?shared=whatsapp` en la URL — asi el
// colega llega a un asesor sin que el mensaje de Sofi tenga que llevar ningun
// link propio de Diamond.
function enlazarWasiPublico(link) {
  if (!link) return link;
  let url;
  try {
    url = new URL(link);
  } catch {
    return link;
  }
  const esDominioWasi = url.hostname === "info.wasi.co" || url.hostname.endsWith(".inmo.co");
  if (!esDominioWasi) return link;
  url.hostname = "info.wasi.co";
  url.searchParams.set("shared", "whatsapp");
  return url.toString();
}

// `linkWasi` conserva el link original ANTES de sobreescribirlo — se lee de
// `p.link` primero, asi que no lo pisa la reescritura de abajo (misma
// propiedad, dos claves distintas del objeto que se arma). Nadie lo consumia
// hasta el 2026-08-18 (Juan pidio, con los ojos abiertos sobre el riesgo, que
// el mensaje "blanqueado" del modo auto use el link de Wasi en vez del propio
// — ver src/groups/redactar.js). Para todo lo demas —chat de cliente, aviso a
// la asesora, cualquier otro consumidor de `properties.search`— `link` sigue
// siendo, como siempre, el de la landing propia.
function withLandingLink(p, landingBaseUrl = config.landingBaseUrl) {
  if (!p) return p;
  return {
    ...p,
    linkWasi: enlazarWasiPublico(p.link),
    link: `${landingBaseUrl || config.landingBaseUrl}/propiedades/${buildSlug(p.titulo, p.ref)}`,
  };
}

// search/findByRef aceptan el org completo (para resolver landing_base_url
// por tenant) o, por compatibilidad, solo el orgId como string — en ese caso
// el link cae al dominio global de config (ver withLandingLink).
function resolveOrg(orgOrId) {
  return orgOrId && typeof orgOrId === "object" ? orgOrId : { id: orgOrId };
}

// zonaTokens/distinctiveTokens viven en src/lib/zonas.js: son puras y el
// prefiltro de grupos las necesita SIN arrastrar Supabase (corre dentro del
// navegador del asesor). Se re-exportan mas abajo porque src/groups/match.js
// las consume como `properties.zonaTokens(...)`.
const { zonaTokens, distinctiveTokens, sonVecinas, vecinosDe, subzonaCoincide } = require("../lib/zonas");

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
    // Antes esto hacia `parseInt(replace(/\D/g, ""))`, que sobre el formato real
    // de Wasi pegaba todos los digitos del texto: "$450.000.000 negociable 2024"
    // devolvia 4500000002024 y la propiedad quedaba fuera de cualquier
    // presupuesto, en silencio. El parser de src/lib/formato.js toma el primer
    // grupo numerico. Mismo bug que en src/groups/match.js, corregido alli el
    // 2026-08-16; esta era la otra mitad, la que ve el cliente.
    const precio = formato.parsearPrecio(p.precio);
    if (precio && precio > f.precio_max) return false;
  }
  return true;
}

// Busca propiedades disponibles de la org. filters: {ref, zona, tipo, precio_max, habitaciones_min}
async function search(orgOrId, filters = {}, limit = 5) {
  const org = resolveOrg(orgOrId);
  const orgId = org.id;
  if (!supabase) {
    return memory.properties
      .filter((p) => p.org_id === orgId && p.disponible && matchesFilters(p, filters))
      .slice(0, limit)
      .map((p) => withLandingLink(p, org.landing_base_url));
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
  return result.slice(0, limit).map((p) => withLandingLink(p, org.landing_base_url));
}

// Busca por referencia exacta, incluidas las no disponibles (para informar que ya no esta)
async function findByRef(orgOrId, ref) {
  const org = resolveOrg(orgOrId);
  const orgId = org.id;
  if (!supabase) {
    const found = memory.properties.find((p) => p.org_id === orgId && p.ref.toUpperCase() === ref.toUpperCase()) || null;
    return withLandingLink(found, org.landing_base_url);
  }
  const { data, error } = await supabase
    .from("properties")
    .select("*")
    .eq("org_id", orgId)
    .ilike("ref", ref)
    .maybeSingle();
  if (error) throw error;
  return withLandingLink(data, org.landing_base_url);
}

// Asigna (o reasigna) el asesor captador de una propiedad. advisorId null
// desmarca. Devuelve la fila actualizada.
async function setCaptador(orgId, propertyId, advisorId) {
  if (!supabase) {
    const prop = memory.properties.find((p) => p.org_id === orgId && p.id === propertyId);
    if (!prop) return null;
    prop.captador_id = advisorId;
    return prop;
  }
  const { data, error } = await supabase
    .from("properties")
    .update({ captador_id: advisorId })
    .eq("org_id", orgId)
    .eq("id", propertyId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Marca (o desmarca) la urgencia de venta de una propiedad. Suma puntaje en
// el cruce del radar de grupos (src/groups/match.js) — ver
// db/migrations/2026-08-21_property_prioridad_venta.sql. Devuelve la fila
// actualizada.
async function setPrioridadVenta(orgId, propertyId, prioridad) {
  if (!supabase) {
    const prop = memory.properties.find((p) => p.org_id === orgId && p.id === propertyId);
    if (!prop) return null;
    prop.prioridad_venta = prioridad;
    return prop;
  }
  const { data, error } = await supabase
    .from("properties")
    .update({ prioridad_venta: prioridad })
    .eq("org_id", orgId)
    .eq("id", propertyId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Propiedades disponibles marcadas a nombre de un asesor.
async function listByCaptador(orgId, advisorId, limit = 20) {
  if (!supabase) {
    return memory.properties.filter((p) => p.org_id === orgId && p.captador_id === advisorId && p.disponible);
  }
  const { data, error } = await supabase
    .from("properties")
    .select("ref, titulo, tipo, operacion, precio, zona, ciudad, disponible")
    .eq("org_id", orgId)
    .eq("captador_id", advisorId)
    .eq("disponible", true)
    .limit(limit);
  if (error) throw error;
  return data || [];
}

module.exports = { search, findByRef, matchesFilters, zonaTokens, distinctiveTokens, sonVecinas, vecinosDe, subzonaCoincide, withLandingLink, enlazarWasiPublico, setCaptador, listByCaptador, setPrioridadVenta };
