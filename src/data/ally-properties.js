const supabase = require("./supabase");
const memory = require("./memory");
const { zonaTokens, distinctiveTokens } = require("./properties");

const ESTADOS_ACTIVOS = ["pendiente", "confirmada"];

function matchesFilters(p, f) {
  if (f.operacion && p.operacion && p.operacion !== f.operacion) return false;
  if (f.tipo && p.tipo && !p.tipo.toLowerCase().includes(f.tipo.toLowerCase())) return false;
  if (f.zona) {
    const haystack = `${p.zona || ""} ${p.ciudad || ""}`.toLowerCase();
    const tokens = distinctiveTokens(zonaTokens(f.zona));
    if (tokens.length > 0 && !tokens.some((t) => haystack.includes(t))) return false;
  }
  if (f.precioMax && p.precio) {
    const precio = parseInt(String(p.precio).replace(/\D/g, ""), 10);
    if (precio && precio > f.precioMax) return false;
  }
  return true;
}

// Guarda una propiedad que un aliado/colega comparte a la red — NUNCA es
// inventario propio. fields puede traer campos parciales (extraccion de
// lenguaje libre por Claude).
async function create(orgId, fields) {
  const row = {
    org_id: orgId,
    ref: fields.ref || null,
    titulo: fields.titulo || null,
    tipo: fields.tipo || null,
    operacion: fields.operacion || null,
    precio: fields.precio || null,
    zona: fields.zona || null,
    ciudad: fields.ciudad || null,
    descripcion: fields.descripcion || null,
    inmobiliaria_origen: fields.inmobiliaria_origen || null,
    contacto_nombre: fields.contacto_nombre || null,
    contacto_telefono: fields.contacto_telefono || null,
    lead_id: fields.lead_id || null,
    mensaje_original: fields.mensaje_original || null,
    registrado_por: fields.registrado_por || null,
    estado: "pendiente",
  };

  if (!supabase) {
    // Dedup en memoria: mismo aliado + misma ref no duplica (mismo criterio
    // del indice unico de la migracion).
    if (row.ref && row.contacto_telefono) {
      const existing = memory.allyProperties.find(
        (a) => a.org_id === orgId && a.contacto_telefono === row.contacto_telefono && a.ref === row.ref
      );
      if (existing) return existing;
    }
    const created = { id: memory.uid(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...row };
    memory.allyProperties.push(created);
    return created;
  }

  // Dedup real: si ya existe (org_id, contacto_telefono, ref), el upsert
  // actualiza en vez de duplicar (mismo indice unico parcial de la migracion).
  if (row.ref && row.contacto_telefono) {
    const { data, error } = await supabase
      .from("ally_properties")
      .upsert(row, { onConflict: "org_id,contacto_telefono,ref" })
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase.from("ally_properties").insert(row).select().single();
  if (error) throw error;
  return data;
}

// Busca propiedades de aliados activas (pendiente|confirmada) que coincidan
// con los filtros — usado como fallback silencioso cuando buscar_propiedades
// no encuentra nada en el inventario propio. filters: {zona, tipo, operacion, precioMax}
async function search(orgId, filters = {}, limit = 3) {
  if (!supabase) {
    return memory.allyProperties
      .filter((a) => a.org_id === orgId && ESTADOS_ACTIVOS.includes(a.estado) && matchesFilters(a, filters))
      .slice(0, limit);
  }
  let query = supabase.from("ally_properties").select("*").eq("org_id", orgId).in("estado", ESTADOS_ACTIVOS);
  if (filters.operacion) query = query.eq("operacion", filters.operacion);
  if (filters.tipo) query = query.ilike("tipo", `%${filters.tipo}%`);
  if (filters.zona) {
    const tokens = distinctiveTokens(zonaTokens(filters.zona));
    if (tokens.length > 0) {
      const ors = tokens.flatMap((t) => [`zona.ilike.%${t}%`, `ciudad.ilike.%${t}%`]);
      query = query.or(ors.join(","));
    }
  }
  const { data, error } = await query.limit(limit * 2);
  if (error) throw error;
  const result = filters.precioMax ? data.filter((p) => matchesFilters(p, { precioMax: filters.precioMax })) : data;
  return result.slice(0, limit);
}

async function findById(orgId, id) {
  if (!supabase) {
    return memory.allyProperties.find((a) => a.org_id === orgId && a.id === id) || null;
  }
  const { data, error } = await supabase.from("ally_properties").select("*").eq("org_id", orgId).eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

async function list(orgId, { estado } = {}) {
  if (!supabase) {
    return memory.allyProperties
      .filter((a) => a.org_id === orgId && (!estado || a.estado === estado))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  let query = supabase.from("ally_properties").select("*").eq("org_id", orgId).order("created_at", { ascending: false });
  if (estado) query = query.eq("estado", estado);
  const { data, error } = await query.limit(200);
  if (error) throw error;
  return data;
}

async function update(orgId, id, fields) {
  if (!supabase) {
    const row = memory.allyProperties.find((a) => a.org_id === orgId && a.id === id);
    if (row) Object.assign(row, fields, { updated_at: new Date().toISOString() });
    return row || null;
  }
  const { data, error } = await supabase
    .from("ally_properties")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Registra que ya se aviso al asesor de un match cliente-aliado para este
// lead (dedup real: unique(ally_property_id, lead_id) en la migracion).
// Devuelve true la PRIMERA vez (aviso nuevo), false si ya se habia notificado.
async function registerAlert(orgId, allyPropertyId, leadId) {
  if (!supabase) {
    const key = `${allyPropertyId}:${leadId}`;
    if (memory.allyPropertyAlerts.includes(key)) return false;
    memory.allyPropertyAlerts.push(key);
    return true;
  }
  const { error } = await supabase
    .from("ally_property_alerts")
    .insert({ ally_property_id: allyPropertyId, lead_id: leadId, org_id: orgId });
  if (error) {
    if (error.code === "23505") return false; // ya existia (violacion del unique)
    throw error;
  }
  return true;
}

module.exports = { create, search, findById, list, update, matchesFilters, registerAlert };
