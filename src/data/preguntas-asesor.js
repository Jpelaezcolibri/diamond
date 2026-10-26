// Preguntas de Sofi al asesor (spec 2026-10-25-sofi-pregunta-al-asesor).
// Sin SUPABASE_URL usa src/data/memory.js, como el resto de src/data.
const supabase = require("./supabase");
const memory = require("./memory");

const ABIERTAS = ["pendiente", "respondida"];

function esTablaAusente(error) {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /preguntas_asesor/.test(String(error.message || "")) && /does not exist|Could not find/i.test(String(error.message || ""));
}

async function crear({ orgId, leadId, ref = null, tipo = "otro", pregunta, asesorId = null }) {
  const refTxt = ref ? String(ref).trim() : null;
  if (!supabase) {
    const ya = memory.preguntasAsesor.find(
      (p) => p.lead_id === leadId && (p.ref || null) === refTxt && p.tipo === tipo && ABIERTAS.includes(p.estado) && !p.entregada_at
    );
    if (ya) return { pregunta: ya, nueva: false };
    const fila = {
      id: memory.uid(), org_id: orgId, lead_id: leadId, ref: refTxt, tipo, pregunta, estado: "pendiente",
      asesor_id: asesorId, asignada_at: new Date().toISOString(), reaviso_at: null, wamids_aviso: [],
      respuesta: null, respondida_por: null, respondida_via: null, respondida_at: null, entregada_at: null,
      entrega_error: null, descartada_por: null, created_at: new Date().toISOString(),
    };
    memory.preguntasAsesor.push(fila);
    return { pregunta: fila, nueva: true };
  }
  let q = supabase.from("preguntas_asesor").select("*").eq("lead_id", leadId).eq("tipo", tipo).in("estado", ABIERTAS).is("entregada_at", null);
  q = refTxt ? q.eq("ref", refTxt) : q.is("ref", null);
  const { data: ya, error: e1 } = await q.limit(1);
  if (e1) throw e1;
  if (ya && ya[0]) return { pregunta: ya[0], nueva: false };
  const { data, error } = await supabase
    .from("preguntas_asesor")
    .insert({ org_id: orgId, lead_id: leadId, ref: refTxt, tipo, pregunta, asesor_id: asesorId })
    .select("*").single();
  if (error) throw error;
  return { pregunta: data, nueva: true };
}

async function pendientes() {
  if (!supabase) return memory.preguntasAsesor.filter((p) => p.estado === "pendiente");
  const { data, error } = await supabase.from("preguntas_asesor").select("*").eq("estado", "pendiente").order("created_at").limit(200);
  if (error) throw error;
  return data || [];
}

async function pendientesDeOrg(orgId) {
  return (await pendientes()).filter((p) => p.org_id === orgId);
}

async function porId(id) {
  if (!supabase) return memory.preguntasAsesor.find((p) => p.id === id) || null;
  const { data, error } = await supabase.from("preguntas_asesor").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function porWamid(wamid) {
  if (!wamid) return null;
  if (!supabase) return memory.preguntasAsesor.find((p) => (p.wamids_aviso || []).includes(wamid)) || null;
  const { data, error } = await supabase.from("preguntas_asesor").select("*").contains("wamids_aviso", [String(wamid)]).limit(1);
  if (error) throw error;
  return (data && data[0]) || null;
}

// Cada aviso (primero, reaviso, rotacion) AGREGA su wamid: el asesor puede citar
// cualquiera de ellos. Nunca se pisa ni se borra.
async function agregarWamid(id, wamid) {
  if (!wamid) return null;
  const p = await porId(id);
  if (!p) return null;
  const actuales = Array.isArray(p.wamids_aviso) ? p.wamids_aviso : [];
  if (actuales.includes(wamid)) return p;
  return actualizar(id, { wamids_aviso: [...actuales, String(wamid)] });
}

async function actualizar(id, patch) {
  if (!supabase) {
    const p = memory.preguntasAsesor.find((x) => x.id === id);
    if (!p) return null;
    Object.assign(p, patch);
    return p;
  }
  const { data, error } = await supabase.from("preguntas_asesor").update(patch).eq("id", id).select("*").maybeSingle();
  if (error) throw error;
  return data || null;
}

// Como actualizar, pero solo si la pregunta sigue pendiente: la escalera no
// pisa (ni avisa) una que alguien acaba de responder. null si ya no lo es.
async function actualizarSiPendiente(id, patch) {
  if (!supabase) {
    const p = memory.preguntasAsesor.find((x) => x.id === id && x.estado === "pendiente");
    if (!p) return null;
    Object.assign(p, patch);
    return p;
  }
  const { data, error } = await supabase.from("preguntas_asesor").update(patch).eq("id", id).eq("estado", "pendiente").select("*").maybeSingle();
  if (error) throw error;
  return data || null;
}

async function marcarRespondida(id, { respuesta, por, via, ahora = new Date() }) {
  const patch = { estado: "respondida", respuesta, respondida_por: por, respondida_via: via, respondida_at: ahora.toISOString() };
  if (!supabase) {
    const p = memory.preguntasAsesor.find((x) => x.id === id && x.estado === "pendiente");
    if (!p) return null;
    Object.assign(p, patch);
    return p;
  }
  const { data, error } = await supabase.from("preguntas_asesor").update(patch).eq("id", id).eq("estado", "pendiente").select("*").maybeSingle();
  if (error) throw error;
  return data || null;
}

async function abiertasDeLead(leadId) {
  if (!supabase) return memory.preguntasAsesor.filter((p) => p.lead_id === leadId && p.estado === "pendiente").length;
  const { count, error } = await supabase.from("preguntas_asesor").select("id", { count: "exact", head: true }).eq("lead_id", leadId).eq("estado", "pendiente");
  if (error) throw error;
  return count || 0;
}

// Respondidas que el colega aun no recibio por la ventana de 24 h (con o sin
// plantilla): salen en su siguiente mensaje, que ya abre la ventana.
const REINTENTABLES = ["esperando_ventana", "ventana_cerrada"];
async function porEntregarDe(leadId) {
  if (!supabase) return memory.preguntasAsesor.filter((p) => p.lead_id === leadId && p.estado === "respondida" && REINTENTABLES.includes(p.entrega_error));
  const { data, error } = await supabase.from("preguntas_asesor").select("*").eq("lead_id", leadId).eq("estado", "respondida").in("entrega_error", REINTENTABLES);
  if (error) throw error;
  return data || [];
}

module.exports = { crear, pendientes, pendientesDeOrg, porId, porWamid, agregarWamid, actualizar, actualizarSiPendiente, marcarRespondida, abiertasDeLead, porEntregarDe, esTablaAusente };
