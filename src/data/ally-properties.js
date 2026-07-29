const supabase = require("./supabase");
const memory = require("./memory");
const { zonaTokens, distinctiveTokens } = require("./properties");

const ESTADOS_ACTIVOS = ["pendiente", "confirmada"];

// Una propiedad que un colega publico en un grupo se vende y nadie avisa.
// Pasados estos dias deja de ofrecerse: recomendarle a un cliente real algo
// que ya no existe es dano de reputacion, no un bug menor. Se refresca cada
// vez que el colega la republica ("sigue disponible"), que es exactamente lo
// que esa frase significa.
//
// 7 dias por decision de Juan (2026-07-28). El criterio no es el espacio —mil
// propiedades pesan menos que una foto— sino la frescura: a las tres semanas
// es muy probable que ya se haya vendido. El costo de la ventana corta es que
// una propiedad que sigue disponible pero nadie republico desaparece; en estos
// grupos se republica seguido, asi que compensa.
const DIAS_VIGENCIA_GRUPO = Number(process.env.ALLY_GRUPO_DIAS || 7);

function cortePorVencimiento() {
  return new Date(Date.now() - DIAS_VIGENCIA_GRUPO * 86400000).toISOString();
}

function vigente(p) {
  if (p.origen !== "grupo") return true;
  if (!p.visto_en_grupo_at) return false;
  return p.visto_en_grupo_at >= cortePorVencimiento();
}

function matchesFilters(p, f) {
  // `origen` separa dos cosas que NO valen lo mismo:
  //   'asesor' — la registro una persona de Diamond, hablo con el colega y la
  //              verifico. Se puede ofrecer con la cara.
  //   'grupo'  — Sofi la leyo al pasar en un grupo. Nadie confirmo que siga
  //              disponible ni que el precio sea ese.
  // Quien consulta decide cual quiere; por defecto siguen viniendo las dos.
  if (f.origen && p.origen !== f.origen) return false;
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
    // Origen 'grupo': detectada por Sofi escuchando un grupo gremial. El
    // puente es el asesor cuya linea la vio — es su grupo y su relacion con
    // ese colega. No es el dueno del negocio.
    origen: fields.origen || "asesor",
    group_id: fields.group_id || null,
    puente_advisor_id: fields.puente_advisor_id || null,
    visto_en_grupo_at: fields.visto_en_grupo_at || null,
  };

  // Las de grupo casi nunca traen ref y los colegas republican la misma
  // propiedad cada semana. La clave es el colega + las caracteristicas, y una
  // republicacion REFRESCA la fecha en vez de duplicar: eso es exactamente lo
  // que significa "sigue disponible".
  if (row.origen === "grupo") return upsertDeGrupo(orgId, row);

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

// Se resuelve leyendo y decidiendo, no con upsert: el indice unico de las de
// grupo va sobre expresiones (coalesce), y PostgREST no acepta eso como
// onConflict. El indice queda igual, como red de seguridad.
function mismaPropiedadDeGrupo(a, row) {
  const n = (v) => String(v || "").trim().toLowerCase();
  return a.origen === "grupo"
    && n(a.contacto_telefono) === n(row.contacto_telefono)
    && n(a.tipo) === n(row.tipo)
    && n(a.zona) === n(row.zona)
    && n(a.precio) === n(row.precio);
}

async function upsertDeGrupo(orgId, row) {
  const refresco = {
    visto_en_grupo_at: row.visto_en_grupo_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (!supabase) {
    const existente = memory.allyProperties.find((a) => a.org_id === orgId && mismaPropiedadDeGrupo(a, row));
    if (existente) {
      // Republicar revive una que habia caducado: el colega esta diciendo que
      // sigue disponible.
      if (existente.estado === "expirada") existente.estado = "pendiente";
      return Object.assign(existente, refresco);
    }
    const creada = { id: memory.uid(), created_at: new Date().toISOString(), ...row };
    memory.allyProperties.push(creada);
    return creada;
  }

  const { data: candidatas } = await supabase
    .from("ally_properties").select("*").eq("org_id", orgId).eq("origen", "grupo")
    .eq("contacto_telefono", row.contacto_telefono || "");
  const existente = (candidatas || []).find((a) => mismaPropiedadDeGrupo(a, row));

  if (existente) {
    const patch = { ...refresco };
    if (existente.estado === "expirada") patch.estado = "pendiente";
    const { data, error } = await supabase
      .from("ally_properties").update(patch).eq("id", existente.id).select().single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase.from("ally_properties").insert(row).select().single();
  if (error) throw error;
  return data;
}

// Busca propiedades de aliados activas (pendiente|confirmada) que coincidan
// con los filtros — usado como fallback silencioso cuando buscar_propiedades
// no encuentra nada en el inventario propio.
// filters: {zona, tipo, operacion, precioMax, origen}
//
// `origen` es la decision importante. Regla de negocio (Juan, 2026-07-29):
//
//   · Para RESPONDERLE A UN COLEGA (una demanda detectada en un grupo) solo
//     valen el inventario propio y los aliados de origen 'asesor'. Contestarle
//     a un colega con la propiedad de OTRO colega, leida al pasar y sin
//     confirmar, pone a Diamond a hacer de intermediaria en un negocio ajeno
//     con informacion que nadie verifico.
//
//   · Para un CLIENTE PROPIO, si no hay nada propio ni en la red de aliados,
//     ahi si se buscan las de origen 'grupo'. Ese fallback vive solo en el
//     flujo de Sofi (src/agent/tools.js): es cuando hay un cliente real
//     esperando y la alternativa es decirle que no tenemos nada.
async function search(orgId, filters = {}, limit = 3) {
  if (!supabase) {
    return memory.allyProperties
      .filter((a) => a.org_id === orgId && ESTADOS_ACTIVOS.includes(a.estado) && vigente(a) && matchesFilters(a, filters))
      .slice(0, limit);
  }
  let query = supabase.from("ally_properties").select("*").eq("org_id", orgId).in("estado", ESTADOS_ACTIVOS);
  // Caducidad de las que vinieron de un grupo. El filtro va DENTRO de search()
  // a proposito: si viviera en cada llamador, tarde o temprano alguien
  // consultaria sin el y Sofi le recomendaria a un cliente real una propiedad
  // que se vendio hace dos meses. Las registradas a mano por un asesor no
  // caducan — es el comportamiento historico y no cambia.
  query = query.or(`origen.neq.grupo,visto_en_grupo_at.gte.${cortePorVencimiento()}`);
  if (filters.origen) query = query.eq("origen", filters.origen);
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

module.exports = { create, search, findById, list, update, matchesFilters, registerAlert, vigente, mismaPropiedadDeGrupo, DIAS_VIGENCIA_GRUPO };
