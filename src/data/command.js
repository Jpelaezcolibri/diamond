// Capa de datos del Centro de Comando (Sofi-Comando): sesiones internas +
// wrappers de las funciones de consulta en base. Sigue el mismo patron que el
// resto de src/data/*: si no hay Supabase configurado (modo demo), degrada a un
// almacen en memoria para que el servidor local no se caiga.
const supabase = require("./supabase");

// ── Modo demo (sin Supabase): sesiones/mensajes en memoria ────────────────
let seq = 0;
const demo = { sessions: [], messages: [] };
const demoId = () => `cmd_${++seq}`;

// ── Consultas agregadas (la base calcula, la IA conversa) ─────────────────
async function metricasLeads(scope, { desde = null, hasta = null } = {}) {
  if (!supabase) return { desde, hasta, nuevos: 0, por_estado: {}, por_fuente: {} };
  const { data, error } = await supabase.rpc("cmd_metricas_leads", {
    p_org: scope.orgId,
    p_uid: scope.viewerUid,
    p_is_admin: scope.isAdmin,
    p_desde: desde,
    p_hasta: hasta,
  });
  if (error) throw error;
  return data;
}

async function seguimientos(scope, { dias = 3 } = {}) {
  if (!supabase) return { total: 0, items: [] };
  const { data, error } = await supabase.rpc("cmd_seguimientos", {
    p_org: scope.orgId,
    p_uid: scope.viewerUid,
    p_is_admin: scope.isAdmin,
    p_dias: dias,
  });
  if (error) throw error;
  return data;
}

// ── Sesiones ──────────────────────────────────────────────────────────────
// Retoma la sesion abierta del usuario o crea una nueva.
async function ensureSession(scope) {
  if (!supabase) {
    let s = demo.sessions.find((x) => x.user_id === scope.viewerUid && !x.closed_at);
    if (!s) {
      s = { id: demoId(), org_id: scope.orgId, user_id: scope.viewerUid, active_context: null, tomorrow_queue: null, opened_at: new Date().toISOString(), closed_at: null };
      demo.sessions.push(s);
    }
    return s;
  }
  const { data: existing, error: findError } = await supabase
    .from("command_sessions")
    .select("*")
    .eq("org_id", scope.orgId)
    .eq("user_id", scope.viewerUid)
    .is("closed_at", null)
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) return existing;
  const { data, error } = await supabase
    .from("command_sessions")
    .insert({ org_id: scope.orgId, user_id: scope.viewerUid })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getSession(sessionId) {
  if (!supabase) return demo.sessions.find((s) => s.id === sessionId) || null;
  const { data } = await supabase.from("command_sessions").select("*").eq("id", sessionId).maybeSingle();
  return data || null;
}

async function appendCommandMessage(sessionId, role, content) {
  if (!supabase) {
    const m = { id: demoId(), session_id: sessionId, role, content, created_at: new Date().toISOString() };
    demo.messages.push(m);
    return m;
  }
  const { data, error } = await supabase
    .from("command_messages")
    .insert({ session_id: sessionId, role, content })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Historial en orden cronologico (para el CRM y para el loop de Claude).
async function getRecentCommandMessages(sessionId, limit = 12) {
  if (!supabase) {
    return demo.messages.filter((m) => m.session_id === sessionId).slice(-limit);
  }
  const { data, error } = await supabase
    .from("command_messages")
    .select("id, role, content, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data.reverse();
}

async function setActiveContext(sessionId, activeContext) {
  if (!supabase) {
    const s = demo.sessions.find((x) => x.id === sessionId);
    if (s) s.active_context = activeContext;
    return;
  }
  await supabase.from("command_sessions").update({ active_context: activeContext }).eq("id", sessionId);
}

// Cierra la sesion y guarda la cola de manana (siembra del dia siguiente).
async function closeSession(sessionId, tomorrowQueue) {
  if (!supabase) {
    const s = demo.sessions.find((x) => x.id === sessionId);
    if (s) { s.closed_at = new Date().toISOString(); s.tomorrow_queue = tomorrowQueue; }
    return s;
  }
  const { data, error } = await supabase
    .from("command_sessions")
    .update({ closed_at: new Date().toISOString(), tomorrow_queue: tomorrowQueue })
    .eq("id", sessionId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Cola de manana de la ultima sesion cerrada del usuario (para el briefing).
async function lastClosedTomorrowQueue(scope) {
  if (!supabase) {
    const s = demo.sessions
      .filter((x) => x.user_id === scope.viewerUid && x.closed_at)
      .sort((a, b) => (a.closed_at < b.closed_at ? 1 : -1))[0];
    return s?.tomorrow_queue || null;
  }
  const { data } = await supabase
    .from("command_sessions")
    .select("tomorrow_queue")
    .eq("org_id", scope.orgId)
    .eq("user_id", scope.viewerUid)
    .not("closed_at", "is", null)
    .order("closed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.tomorrow_queue || null;
}

module.exports = {
  metricasLeads,
  seguimientos,
  ensureSession,
  getSession,
  appendCommandMessage,
  getRecentCommandMessages,
  setActiveContext,
  closeSession,
  lastClosedTomorrowQueue,
};
