// La numeracion del cierre del dia, guardada — ver db/migrations/2026-09-06_radar_cierres.sql.
//
// POR QUE SE GUARDA Y NO SE RECALCULA. El cierre le pide a la asesora que
// responda POR NUMERO ("1 no servia, 3 hubo visita"). Ese numero tiene que
// significar lo mismo cuando ella contesta que cuando se envio. Si la lista se
// volviera a calcular al recibir la respuesta, cualquier señal que entre entre
// las 18:30 y su contestacion corre la numeracion y el resultado queda
// registrado sobre la propiedad equivocada. Registrar mal es peor que no
// registrar — es lo mismo que ya evita registrarResultadoRadar negandose a
// adivinar cuando hay varios pendientes.
//
// Se degrada en vez de romper si la migracion no corrio: el cierre no sale, el
// resto del radar sigue igual.

const supabase = require("./supabase");

// La ventana para cobrar una respuesta. Tres dias cubre el fin de semana: un
// cierre del viernes se puede contestar el lunes. Mas alla, la asesora ya no
// se acuerda de que numero era cual y registrar seria adivinar.
const DIAS_COBRABLES = 3;

function esTablaFaltante(error) {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

function avisarSiFalta(error, accion) {
  if (esTablaFaltante(error)) {
    console.error(`[cierre-dia] Falta la migracion 2026-09-06_radar_cierres.sql: ${accion}`);
    return true;
  }
  return false;
}

// Lo que se movio en la ventana: le llego un aviso a la asesora para decidir,
// O salio un mensaje al colega. Las dos cosas son "gestion" y las dos merecen
// un resultado — hasta hoy solo se preguntaba por la primera, que es el 18% de
// lo que de verdad se mueve.
//
// Se traen los campos que necesita cierre-dia.armar y nada mas.
async function movidasDelDia(orgId, { desdeIso, hastaIso }) {
  if (!supabase) return [];
  const CAMPOS =
    "id, created_at, autor_nombre, texto_original, matches, revalidacion, enviado_at, aviso_advisor_id, respondida_at, respuesta_modo, respuesta_refs";
  const { data, error } = await supabase
    .from("group_signals")
    .select(CAMPOS)
    .eq("org_id", orgId)
    .eq("origen", "vivo")
    .gte("created_at", desdeIso)
    .lt("created_at", hastaIso)
    .or("enviado_at.not.is.null,respondida_at.not.is.null")
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[cierre-dia] No se pudieron leer las señales del dia:", error.message);
    return [];
  }
  // El filtro de canal va aca y no en la consulta: `respondida_at` con modo
  // 'sombra' es un borrador que nadie recibio, y preguntar por el seria
  // preguntar por algo que no paso.
  return (data || []).filter((s) => s.enviado_at || (s.respondida_at && s.respuesta_modo === "auto"));
}

// Reclamo atomico del dia: el unique (org_id, advisor_id, fecha) hace que dos
// corridas no puedan mandar dos cierres. Devuelve la fila si este proceso gano,
// null si ya existia o si la tabla no esta.
async function reclamar(orgId, advisorId, fecha, items) {
  if (!supabase) return { id: "memoria", org_id: orgId, advisor_id: advisorId, fecha, items };
  const { data, error } = await supabase
    .from("radar_cierres")
    .insert({ org_id: orgId, advisor_id: advisorId, fecha, items })
    .select()
    .single();
  if (error) {
    // 23505 = unique violation: otro tick ya lo reclamo hoy. No es un fallo.
    if (error.code === "23505") return null;
    if (avisarSiFalta(error, "no se puede armar el cierre del dia.")) return null;
    console.error("[cierre-dia] No se pudo reclamar el cierre:", error.message);
    return null;
  }
  return data;
}

// Se marca DESPUES de que WhatsApp lo acepto. Si la ventana de 24h estaba
// cerrada, la fila queda con enviado_at null a proposito: ese dia se ve como
// "se armo y no se pudo entregar", en vez de desaparecer del registro.
async function marcarEnviado(cierreId) {
  if (!supabase || cierreId === "memoria") return true;
  const { error } = await supabase
    .from("radar_cierres")
    .update({ enviado_at: new Date().toISOString() })
    .eq("id", cierreId);
  if (error) {
    console.error("[cierre-dia] No se pudo marcar el cierre como enviado:", error.message);
    return false;
  }
  return true;
}

// El cierre contra el que se resuelve un "1 no servia". El mas reciente que SI
// se entrego: uno que nunca salio no puede tener numeros que ella haya visto.
async function ultimoCobrable(orgId, advisorId, { hoy = new Date() } = {}) {
  if (!supabase) return null;
  const desde = new Date(hoy.getTime() - DIAS_COBRABLES * 86400000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("radar_cierres")
    .select("id, fecha, items, enviado_at")
    .eq("org_id", orgId)
    .eq("advisor_id", advisorId)
    .not("enviado_at", "is", null)
    .gte("fecha", desde)
    .order("fecha", { ascending: false })
    .limit(1);
  if (error) {
    avisarSiFalta(error, "no se puede cobrar el resultado por numero.");
    return null;
  }
  return data && data.length ? data[0] : null;
}

module.exports = { movidasDelDia, reclamar, marcarEnviado, ultimoCobrable, DIAS_COBRABLES };
