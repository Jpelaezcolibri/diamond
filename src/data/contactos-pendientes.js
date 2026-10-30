// Pendientes de contactar por la asesora (spec 2026-10-30). Sin SUPABASE_URL
// usa src/data/memory.js, como el resto de src/data. Si la tabla no existe
// (migracion 2026-10-30_contactos_pendientes sin correr), disponible() da
// false y los que llaman siguen como antes.
const supabase = require("./supabase");
const memory = require("./memory");

const ABIERTOS = ["pendiente", "enviado"];
let tablaAusente = false;
let correlativo = 0;

function esTablaAusente(error) {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || (/contactos_pendientes/.test(String(error.message || "")) && /does not exist|Could not find/i.test(String(error.message || "")));
}
function vigilar(error) {
  if (esTablaAusente(error)) {
    if (!tablaAusente) console.warn("[contactos-pendientes] falta la tabla: correr db/migrations/2026-10-30_contactos_pendientes.sql");
    tablaAusente = true;
  }
  throw error;
}

async function disponible() {
  if (!supabase) return true;
  if (tablaAusente) return false;
  const { error } = await supabase.from("contactos_pendientes").select("id").limit(1);
  if (error && esTablaAusente(error)) { tablaAusente = true; return false; }
  return !error;
}

async function abrir({ orgId, leadId, conversationId = null, asesorId = null, motivo }) {
  if (!supabase) {
    const ya = memory.contactosPendientes.find((p) => p.lead_id === leadId && ABIERTOS.includes(p.estado));
    if (ya) { ya.motivo = motivo; return { pendiente: ya, nuevo: false }; }
    correlativo += 1;
    const fila = {
      id: memory.uid(), codigo: `C-${String(correlativo).padStart(4, "0")}`, org_id: orgId, lead_id: leadId,
      conversation_id: conversationId, asesor_id: asesorId, motivo, estado: "pendiente", intentos: 0,
      lote_id: null, enviado_at: null, resultado: null, nota: null, resuelto_at: null, resuelto_por: null,
      archivo_url: null, created_at: new Date().toISOString(),
    };
    memory.contactosPendientes.push(fila);
    return { pendiente: fila, nuevo: true };
  }
  const { data: ya, error: e1 } = await supabase.from("contactos_pendientes").select("*").eq("lead_id", leadId).in("estado", ABIERTOS).limit(1);
  if (e1) vigilar(e1);
  if (ya && ya[0]) {
    const { data } = await supabase.from("contactos_pendientes").update({ motivo }).eq("id", ya[0].id).select("*").maybeSingle();
    return { pendiente: data || ya[0], nuevo: false };
  }
  const { data, error } = await supabase
    .from("contactos_pendientes")
    .insert({ org_id: orgId, lead_id: leadId, conversation_id: conversationId, asesor_id: asesorId, motivo })
    .select("*").single();
  if (error) vigilar(error);
  return { pendiente: data, nuevo: true };
}

async function abiertos(orgId) {
  if (!supabase) return memory.contactosPendientes.filter((p) => p.org_id === orgId && ABIERTOS.includes(p.estado));
  const { data, error } = await supabase.from("contactos_pendientes").select("*").eq("org_id", orgId).in("estado", ABIERTOS).order("created_at").limit(500);
  if (error) vigilar(error);
  return data || [];
}

async function porCodigos(orgId, codigos) {
  const lista = [...new Set((codigos || []).map((c) => String(c).trim().toUpperCase()).filter(Boolean))];
  if (lista.length === 0) return [];
  if (!supabase) return memory.contactosPendientes.filter((p) => p.org_id === orgId && lista.includes(p.codigo));
  const { data, error } = await supabase.from("contactos_pendientes").select("*").eq("org_id", orgId).in("codigo", lista);
  if (error) vigilar(error);
  return data || [];
}

async function marcarEnviados(ids, { loteId, asesorId }) {
  if (!ids || ids.length === 0) return;
  const patch = { estado: "enviado", lote_id: loteId, asesor_id: asesorId, enviado_at: new Date().toISOString() };
  if (!supabase) {
    for (const p of memory.contactosPendientes) if (ids.includes(p.id) && ABIERTOS.includes(p.estado)) Object.assign(p, patch);
    return;
  }
  const { error } = await supabase.from("contactos_pendientes").update(patch).in("id", ids).in("estado", ABIERTOS);
  if (error) vigilar(error);
}

// Solo si sigue abierto: mandar el mismo Excel dos veces no aplica nada dos veces.
async function actualizarSiAbierto(id, patch) {
  if (!supabase) {
    const p = memory.contactosPendientes.find((x) => x.id === id && ABIERTOS.includes(x.estado));
    if (!p) return null;
    Object.assign(p, patch);
    return p;
  }
  const { data, error } = await supabase.from("contactos_pendientes").update(patch).eq("id", id).in("estado", ABIERTOS).select("*").maybeSingle();
  if (error) vigilar(error);
  return data || null;
}

function cerrar(id, { estado = "resuelto", resultado, nota = null, por = null, intentos, archivoUrl = null }) {
  const patch = { estado, resultado, nota, resuelto_por: por, resuelto_at: new Date().toISOString(), archivo_url: archivoUrl };
  if (intentos !== undefined) patch.intentos = intentos;
  return actualizarSiAbierto(id, patch);
}

function volverAPendiente(id, { intentos, nota = null, por = null }) {
  return actualizarSiAbierto(id, { estado: "pendiente", intentos, nota, resuelto_por: por, resultado: "no_contesta" });
}

async function resolverPorLead(leadId, resultado) {
  const patch = { estado: "resuelto", resultado, resuelto_at: new Date().toISOString(), resuelto_por: "sistema" };
  if (!supabase) {
    let n = 0;
    for (const p of memory.contactosPendientes) if (p.lead_id === leadId && ABIERTOS.includes(p.estado)) { Object.assign(p, patch); n++; }
    return n;
  }
  if (tablaAusente) return 0;
  const { data, error } = await supabase.from("contactos_pendientes").update(patch).eq("lead_id", leadId).in("estado", ABIERTOS).select("id");
  if (error) vigilar(error);
  return (data || []).length;
}

module.exports = { abrir, abiertos, porCodigos, marcarEnviados, cerrar, volverAPendiente, resolverPorLead, disponible, esTablaAusente };
