// Visitas/avances agendados que el sistema pudo CAPTURAR — Juan, 2026-08-21:
// "todo lo que pase por Diamond que se pueda poner como agendada la pones y
// la mides, lo que esta por fuera de manera manual lo hacemos despues".
//
// Dos fuentes hoy, deliberadamente NO tres: lo que un asesor coordina por
// telefono o por su WhatsApp personal, fuera del bot, no deja ningun rastro
// y no esta aca — ese hueco se cierra en una fase futura (captura manual).
//
//   1. leads.cita        cliente que agendo directo con Sofi (agendar_cita).
//   2. linea_dm           colega con avance detectado en la linea de Natalia
//                         (src/groups/dm.js), resuelto a un ref via el
//                         pedido de grupo que publico (group_signals.matches).
//
// Usado por src/scheduler/visitas-venta.js para el cruce diario contra Wasi.

const supabase = require("./supabase");

function esTablaFaltante(error) {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

// { ref, origen: "cliente"|"colega", quien, fechaHoraIso }[] — una fila por
// visita/avance, SIN deduplicar por ref (el llamador decide como agrupar).
async function recientes(orgId, { dias = 30 } = {}) {
  if (!supabase) return [];
  const desde = new Date(Date.now() - dias * 86400000).toISOString();

  const [leadsRes, dmRes] = await Promise.all([
    supabase
      .from("leads")
      .select("id, nombre, phone, property_ref_origen, cita")
      .eq("org_id", orgId)
      .not("cita", "is", null)
      .not("property_ref_origen", "is", null),
    supabase
      .from("linea_dm")
      .select("id, remitente_nombre, remitente_telefono, senal_id, cita_fecha_hora_iso, created_at")
      .eq("org_id", orgId)
      .eq("tiene_cita", true)
      .gte("created_at", desde),
  ]);

  const out = [];

  for (const l of leadsRes.data || []) {
    const fecha = l.cita?.fecha_hora;
    if (!fecha || new Date(fecha) < new Date(desde)) continue;
    out.push({ ref: l.property_ref_origen, origen: "cliente", quien: l.nombre || `+${l.phone}`, fechaHoraIso: fecha });
  }

  const dmFilas = dmRes.data || [];
  const idsSeñal = [...new Set(dmFilas.map((m) => m.senal_id).filter(Boolean))];
  const refPorSeñal = new Map();
  if (idsSeñal.length && !esTablaFaltante(dmRes.error)) {
    const { data: señales } = await supabase.from("group_signals").select("id, matches").in("id", idsSeñal);
    for (const s of señales || []) refPorSeñal.set(s.id, (s.matches || [])[0]?.ref || null);
  }
  for (const m of dmFilas) {
    const ref = m.senal_id ? refPorSeñal.get(m.senal_id) : null;
    if (!ref) continue;
    out.push({
      ref,
      origen: "colega",
      quien: m.remitente_nombre || m.remitente_telefono || "un colega",
      fechaHoraIso: m.cita_fecha_hora_iso || m.created_at,
    });
  }

  return out;
}

async function yaAlertada(orgId, ref) {
  if (!supabase) return false;
  const { data, error } = await supabase
    .from("visita_venta_alertas")
    .select("id")
    .eq("org_id", orgId)
    .eq("ref", ref)
    .maybeSingle();
  if (error) {
    if (esTablaFaltante(error)) return false;
    console.error("[visitas] No se pudo verificar si ya se alerto:", error.message);
    return false;
  }
  return Boolean(data);
}

// `visita` (quien/origen/fechaHoraIso) se guarda TAL CUAL estaba al avisar —
// no se recalcula despues. `recientes()` solo mira los ultimos 30 dias: sin
// esto, el panel "Posibles ventas" del CRM perderia el dato de que visita
// fue una vez que la ventana pasa.
async function marcarAlertada(orgId, ref, visita = {}) {
  if (!supabase) return true;
  const { error } = await supabase.from("visita_venta_alertas").insert({
    org_id: orgId,
    ref,
    visita_quien: visita.quien || null,
    visita_origen: visita.origen || null,
    visita_fecha_hora_iso: visita.fechaHoraIso || null,
  });
  // 23505: ya estaba marcada (carrera entre dos corridas) — no es un fallo.
  if (error && error.code !== "23505") {
    if (esTablaFaltante(error)) return false;
    console.error("[visitas] No se pudo marcar la alerta:", error.message);
    return false;
  }
  return true;
}

const ESTADOS_ALERTA = ["pendiente", "confirmada", "descartada"];

// El panel "Posibles ventas" del CRM (Juan, 2026-08-21) confirma o descarta
// cada aviso — queda guardado, no solo el mensaje de WhatsApp que ya llego.
async function setEstadoAlerta(orgId, id, estado, actualizadoPor = null) {
  if (!ESTADOS_ALERTA.includes(estado)) throw new Error(`Estado invalido: ${estado}`);
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("visita_venta_alertas")
    .update({ estado, actualizado_por: actualizadoPor, actualizado_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) {
    if (esTablaFaltante(error)) return null;
    throw error;
  }
  return data;
}

module.exports = { recientes, yaAlertada, marcarAlertada, setEstadoAlerta, ESTADOS_ALERTA };
