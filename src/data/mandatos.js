//
// Acceso a mandatos_compra: los clientes que Diamond tiene BUSCANDO. Solo I/O —
// la decision de si una oferta le sirve a un mandato vive en
// src/groups/cruce-mandatos.js, y el aviso en src/groups/avisar-mandato.js.
//
// Sin supabase (tests, dev sin credenciales) guarda en memoria con el mismo
// contrato, igual que src/data/command.js.
// OJO: src/data/supabase.js hace `module.exports = client` — exporta el cliente
// DIRECTO, no un objeto. Destructurar `{ supabase }` da undefined y este modulo
// nunca escribiria en la base real: caeria SIEMPRE en la rama de memoria, en
// silencio y tambien en produccion. Se importa igual que los 10 modulos
// hermanos de src/data/.
const supabase = require("./supabase");

const memory = { mandatos: [], alertas: [] };
let seq = 0;
const nuevoId = (p) => `${p}-${++seq}`;

// PGRST204: PostgREST no encuentra la columna en su cache de esquema.
// 42703: Postgres dice que la columna no existe. Mismo criterio que
// src/data/group-signals.js#esColumnaFaltante.
function esColumnaFaltante(error) {
  return error?.code === "PGRST204" || error?.code === "42703";
}

// Campos que el insert puede mandar. Se lista explicito para que un campo nuevo
// del clasificador no viaje sin que alguien lo piense (y para que el reintento
// por columna faltante sepa que sacar).
const CAMPOS = [
  "cliente_nombre", "cliente_telefono", "advisor_id", "registrado_por",
  "operacion", "tipo", "zonas", "zonas_excluidas", "ciudad",
  "precio_min", "precio_max", "habitaciones", "flexible_habitaciones",
  "area_min", "banos", "garajes", "estrato",
  "exigencias", "plazo", "texto_original", "notas",
];

// null y 0 no son lo mismo acá: precio_max = 0 significaria "sin tope" para el
// motor de cruce y matchearia media ciudad; null significa "no se sabe". El
// clasificador devuelve 0 cuando no encuentra el dato, asi que se traduce.
function nadaEsCero(v) {
  return v === 0 || v === "" || v === undefined ? null : v;
}

function normalizar(fields) {
  const row = {};
  for (const c of CAMPOS) {
    if (c === "zonas" || c === "zonas_excluidas" || c === "exigencias") {
      row[c] = Array.isArray(fields[c]) ? fields[c] : [];
    } else if (c === "flexible_habitaciones") {
      row[c] = Boolean(fields[c]);
    } else if (c === "cliente_nombre") {
      row[c] = String(fields[c] || "").trim() || null;
    } else {
      row[c] = nadaEsCero(fields[c]) ?? null;
    }
  }
  return row;
}

async function crear(orgId, fields) {
  const row = { org_id: orgId, estado: "activo", ...normalizar(fields) };
  if (!row.cliente_nombre) throw new Error("Un mandato necesita cliente_nombre");
  if (!row.operacion) throw new Error("Un mandato necesita operacion (venta o arriendo)");

  if (!supabase) {
    const guardado = { id: nuevoId("mandato"), created_at: new Date().toISOString(), ...row };
    memory.mandatos.push(guardado);
    return guardado;
  }
  const { data, error } = await supabase.from("mandatos_compra").insert(row).select().single();
  if (error) throw error;
  return data;
}

async function listarActivos(orgId) {
  if (!supabase) {
    return memory.mandatos.filter((m) => m.org_id === orgId && m.estado === "activo");
  }
  const { data, error } = await supabase
    .from("mandatos_compra")
    .select("*")
    .eq("org_id", orgId)
    .eq("estado", "activo")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data || [];
}

async function findById(orgId, id) {
  if (!supabase) return memory.mandatos.find((m) => m.id === id && m.org_id === orgId) || null;
  const { data, error } = await supabase
    .from("mandatos_compra").select("*").eq("org_id", orgId).eq("id", id).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function actualizarEstado(orgId, id, estado) {
  if (!supabase) {
    const m = memory.mandatos.find((x) => x.id === id && x.org_id === orgId);
    if (m) m.estado = estado;
    return m || null;
  }
  const { data, error } = await supabase
    .from("mandatos_compra")
    .update({ estado, updated_at: new Date().toISOString() })
    .eq("org_id", orgId).eq("id", id).select().maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * Reserva el aviso ANTES de mandarlo. Devuelve {esNuevo:false} si ya existia:
 * un colega que republica la misma propiedad no genera un segundo WhatsApp.
 * Mismo criterio que allyProperties.registerAlert.
 */
async function registrarAlerta(orgId, { mandatoId, allyPropertyId, advisorId = null, puntaje = null }) {
  if (!supabase) {
    const ya = memory.alertas.find(
      (a) => a.org_id === orgId && a.mandato_id === mandatoId && a.ally_property_id === allyPropertyId
    );
    if (ya) return { esNuevo: false, id: ya.id };
    const a = {
      id: nuevoId("alerta"), org_id: orgId, mandato_id: mandatoId,
      ally_property_id: allyPropertyId, advisor_id: advisorId, puntaje,
      entregado: false, created_at: new Date().toISOString(),
    };
    memory.alertas.push(a);
    return { esNuevo: true, id: a.id };
  }
  const { data, error } = await supabase
    .from("mandato_match_alerts")
    .insert({ org_id: orgId, mandato_id: mandatoId, ally_property_id: allyPropertyId, advisor_id: advisorId, puntaje })
    .select("id")
    .single();
  // 23505 = unique_violation: ya se aviso de este par. No es un error.
  if (error && error.code === "23505") return { esNuevo: false, id: null };
  if (error) throw error;
  return { esNuevo: true, id: data.id };
}

// `texto` (Juan, 2026-08-26): el cuerpo EXACTO del aviso que se le mando al
// asesor, para poder reenviarselo identico a Catherine si hay que escalar por
// silencio -- en vez de reconstruirlo, que podria divergir del original.
// Requiere la migracion 2026-08-26_mandato_match_alerts_texto; si todavia no
// corrio, se reintenta sin esa columna en vez de perder el resto del registro
// (entregado/via/error), mismo criterio que src/data/group-signals.js.
async function marcarEntrega(orgId, alertaId, { entregado, via = null, error = null, texto = null }) {
  if (!alertaId) return;
  const campos = {
    entregado: Boolean(entregado),
    entregado_at: entregado ? new Date().toISOString() : null,
    via, error, texto,
  };
  if (!supabase) {
    const a = memory.alertas.find((x) => x.org_id === orgId && x.id === alertaId);
    if (a) Object.assign(a, campos);
    return;
  }
  const { error: e } = await supabase
    .from("mandato_match_alerts").update(campos).eq("org_id", orgId).eq("id", alertaId);
  if (e) {
    if (esColumnaFaltante(e)) {
      const { texto: _t, ...sinTexto } = campos;
      const { error: e2 } = await supabase
        .from("mandato_match_alerts").update(sinTexto).eq("org_id", orgId).eq("id", alertaId);
      if (e2) console.warn("[mandatos] no se pudo marcar la entrega:", e2.message);
      return;
    }
    console.warn("[mandatos] no se pudo marcar la entrega:", e.message);
  }
}

async function marcarEscalado(orgId, alertaId, telefono) {
  if (!alertaId) return;
  const campos = { escalado_a: telefono, escalado_at: new Date().toISOString() };
  if (!supabase) {
    const a = memory.alertas.find((x) => x.org_id === orgId && x.id === alertaId);
    if (a) Object.assign(a, campos);
    return;
  }
  const { error } = await supabase
    .from("mandato_match_alerts").update(campos).eq("org_id", orgId).eq("id", alertaId);
  if (error) console.warn("[mandatos] no se pudo marcar el escalado:", error.message);
}

async function pendientes(orgId, { limite = 50 } = {}) {
  if (!supabase) {
    return memory.alertas
      .filter((a) => a.org_id === orgId && !a.entregado)
      .slice(0, limite);
  }
  const { data, error } = await supabase
    .from("mandato_match_alerts")
    .select("*")
    .eq("org_id", orgId)
    .eq("entregado", false)
    .order("created_at", { ascending: false })
    .limit(limite);
  if (error) throw error;
  return data || [];
}

// Cuantos avisos se generaron HOY para un mandato. Alimenta el tope diario
// (RADAR_MANDATO_MAX_DIA). Se cuenta sobre las alertas creadas, no sobre las
// entregadas: el tope existe para no ahogar al asesor, y un aviso que salio y
// fallo igual le llego el intento.
async function avisosHoy(orgId, mandatoId) {
  const desde = new Date();
  desde.setHours(0, 0, 0, 0);
  if (!supabase) {
    return memory.alertas.filter(
      (a) => a.org_id === orgId && a.mandato_id === mandatoId && a.created_at >= desde.toISOString()
    ).length;
  }
  const { count, error } = await supabase
    .from("mandato_match_alerts")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("mandato_id", mandatoId)
    .gte("created_at", desde.toISOString());
  // Ante la duda NO se frena: este tope nace apagado (default 0 = sin limite) y
  // su proposito es aliviar, no descartar oportunidades. Si no se pudo contar,
  // se deja pasar — al contrario del criterio de politica.js, donde callar es
  // gratis porque el riesgo es publicar ante 80 competidores.
  if (error) {
    console.warn("[mandatos] no se pudo contar los avisos de hoy:", error.message);
    return 0;
  }
  return count || 0;
}

// Matches entregados hace mas de `antesDeIso` sin escalar todavia por
// silencio -- candidatos para src/scheduler/radar-silencio.js (carril de
// compra). El check de "Natalia SI respondio" lo hace el scheduler, cruzando
// contra la conversacion de la linea del asesor principal (misma separacion
// de responsabilidades que candidatosRecordatorio en group-signals.js).
async function pendientesDeSilencio(orgId, { antesDeIso, limite = 100 } = {}) {
  if (!supabase) {
    return memory.alertas.filter(
      (a) => a.org_id === orgId && a.entregado && !a.escalado_a && a.entregado_at && a.entregado_at <= antesDeIso
    ).slice(0, limite);
  }
  const { data, error } = await supabase
    .from("mandato_match_alerts")
    .select("id, mandato_id, ally_property_id, advisor_id, texto, entregado_at")
    .eq("org_id", orgId)
    .eq("entregado", true)
    .is("escalado_a", null)
    .lte("entregado_at", antesDeIso)
    .limit(limite);
  if (error) {
    if (esColumnaFaltante(error)) return [];
    console.warn("[mandatos] no se pudieron leer los pendientes de silencio:", error.message);
    return [];
  }
  return data || [];
}

function _reset() {
  memory.mandatos = [];
  memory.alertas = [];
  seq = 0;
}

module.exports = {
  crear, listarActivos, findById, actualizarEstado,
  registrarAlerta, marcarEntrega, marcarEscalado, pendientes, pendientesDeSilencio, avisosHoy, CAMPOS, _reset,
};
