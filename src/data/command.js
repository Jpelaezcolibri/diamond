// Capa de datos del Centro de Comando (Sofi-Comando): sesiones internas +
// wrappers de las funciones de consulta en base. Sigue el mismo patron que el
// resto de src/data/*: si no hay Supabase configurado (modo demo), degrada a un
// almacen en memoria para que el servidor local no se caiga.
const supabase = require("./supabase");
const memory = require("./memory");
const { zonaTokens, distinctiveTokens } = require("./properties");

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

// ── Consultas para el copiloto del asesor ──────────────────────────────────
// Mismo principio de alcance que los RPC cmd_*: el asesor solo ve SUS leads
// (owner_id = viewerUid), el admin toda la org. El scope viene del servidor,
// nunca del modelo.

// Presupuestos de leads son texto libre ("1.300 millones", "500.000.000",
// "80 millones", "2.500.000 para arriendo"). Devuelve pesos o null.
function parsePresupuesto(texto) {
  if (!texto) return null;
  const digits = String(texto).replace(/\D/g, "");
  if (!digits) return null;
  let n = parseInt(digits, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  // "1300" o "1.300 millones" -> el cliente habla en millones. Un presupuesto
  // inmobiliario real en pesos siempre supera los $100.000; por debajo de eso
  // el numero viene expresado en millones.
  if (/millon/i.test(texto) || n < 100000) n = n * 1000000;
  return n;
}

// Matching puro lead↔propiedad (exportado para tests). Devuelve los leads que
// encajan con la propiedad, cada uno con las razones de la coincidencia.
function matchLeadsConPropiedad(leadsList, propiedad, limit = 10) {
  const precio = parsePresupuesto(propiedad.precio);
  const propOper = (propiedad.operacion || "").toLowerCase();
  const haystack = `${propiedad.zona || ""} ${propiedad.ciudad || ""}`.toLowerCase();
  const propTipo = (propiedad.tipo || "").toLowerCase();

  const candidatos = [];
  for (const l of leadsList) {
    if (["descartado", "perdido", "cerrado"].includes(l.estado)) continue;
    const cat = (l.categoria || "").toLowerCase();
    // Un lead de arriendo no encaja con una propiedad en venta (y viceversa).
    if (propOper === "venta" && cat === "alquiler") continue;
    if (propOper === "arriendo" && cat === "compra") continue;

    const razones = [];
    if (l.zona_interes) {
      const tokens = distinctiveTokens(zonaTokens(l.zona_interes));
      if (tokens.length > 0 && tokens.some((t) => haystack.includes(t))) razones.push("zona");
    }
    const presupuesto = parsePresupuesto(l.presupuesto);
    if (presupuesto && precio) {
      // Con margen: si el presupuesto cubre el 90% del precio, hay negocio posible.
      if (presupuesto >= precio * 0.9) razones.push("presupuesto");
      else continue; // presupuesto declarado y no alcanza: no es candidato
    }
    if (l.tipo_interes && propTipo) {
      const ti = l.tipo_interes.toLowerCase();
      if (ti.includes(propTipo) || propTipo.includes(ti.trim())) razones.push("tipo");
    }
    // Para entrar a la lista tiene que coincidir en algo sustantivo (zona o
    // presupuesto), no solo en el tipo.
    if (!razones.includes("zona") && !razones.includes("presupuesto")) continue;

    candidatos.push({
      lead_id: l.id,
      nombre: l.nombre || null,
      phone: l.phone || null,
      estado: l.estado,
      score: l.score || 0,
      presupuesto: l.presupuesto || null,
      zona_interes: l.zona_interes || null,
      tipo_interes: l.tipo_interes || null,
      coincide_en: razones,
    });
  }
  candidatos.sort((a, b) => b.coincide_en.length - a.coincide_en.length || b.score - a.score);
  return candidatos.slice(0, limit);
}

// Busca leads del alcance por nombre o telefono (para resumen_lead).
async function buscarLeads(scope, q, limit = 5) {
  const texto = String(q || "").replace(/[,()%]/g, " ").trim();
  if (!texto) return [];
  const digits = texto.replace(/\D/g, "");
  if (!supabase) {
    return memory.leads
      .filter(
        (l) =>
          l.org_id === scope.orgId &&
          (scope.isAdmin || l.owner_id === scope.viewerUid) &&
          ((l.nombre || "").toLowerCase().includes(texto.toLowerCase()) ||
            (digits.length >= 4 && String(l.phone || "").includes(digits)))
      )
      .slice(0, limit);
  }
  let query = supabase.from("leads").select("*").eq("org_id", scope.orgId);
  if (!scope.isAdmin) query = query.eq("owner_id", scope.viewerUid);
  const ors = [`nombre.ilike.%${texto}%`];
  if (digits.length >= 4) ors.push(`phone.like.%${digits}%`);
  query = query.or(ors.join(","));
  const { data, error } = await query.order("updated_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}

// Conversacion mas reciente de un lead DEL ALCANCE (verifica el scope releyendo
// el lead con los mismos filtros antes de exponer mensajes).
async function conversacionDeLead(scope, leadId, limit = 30) {
  if (!supabase) {
    const lead = memory.leads.find(
      (l) => l.id === leadId && l.org_id === scope.orgId && (scope.isAdmin || l.owner_id === scope.viewerUid)
    );
    if (!lead) return null;
    const conv = memory.conversations.find((c) => c.lead_id === leadId);
    const mensajes = conv
      ? memory.messages
          .filter((m) => m.conversation_id === conv.id)
          .slice(-limit)
          .map((m) => ({ role: m.role, content: String(m.content || "").slice(0, 400) }))
      : [];
    return { lead, mensajes };
  }
  let leadQuery = supabase.from("leads").select("*").eq("org_id", scope.orgId).eq("id", leadId);
  if (!scope.isAdmin) leadQuery = leadQuery.eq("owner_id", scope.viewerUid);
  const { data: lead, error: leadError } = await leadQuery.maybeSingle();
  if (leadError) throw leadError;
  if (!lead) return null;

  const { data: conv } = await supabase
    .from("conversations")
    .select("id")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let mensajes = [];
  if (conv) {
    const { data, error } = await supabase
      .from("messages")
      .select("role, content, created_at")
      .eq("conversation_id", conv.id)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    mensajes = data.reverse().map((m) => ({
      role: m.role,
      content: String(m.content || "").slice(0, 400),
      created_at: m.created_at,
    }));
  }
  return { lead, mensajes };
}

// Leads activos del alcance que encajan con una propiedad (cruce inverso).
async function leadsParaPropiedad(scope, propiedad, limit = 10) {
  const ESTADOS_ACTIVOS = ["nuevo", "calificado", "transferido"];
  let candidatos;
  if (!supabase) {
    candidatos = memory.leads.filter(
      (l) =>
        l.org_id === scope.orgId &&
        (scope.isAdmin || l.owner_id === scope.viewerUid) &&
        ESTADOS_ACTIVOS.includes(l.estado)
    );
  } else {
    let query = supabase
      .from("leads")
      .select("id, nombre, phone, estado, score, categoria, presupuesto, zona_interes, tipo_interes, owner_id")
      .eq("org_id", scope.orgId)
      .in("estado", ESTADOS_ACTIVOS);
    if (!scope.isAdmin) query = query.eq("owner_id", scope.viewerUid);
    const { data, error } = await query.order("updated_at", { ascending: false }).limit(300);
    if (error) throw error;
    candidatos = data;
  }
  return matchLeadsConPropiedad(candidatos, propiedad, limit);
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
  buscarLeads,
  conversacionDeLead,
  leadsParaPropiedad,
  // Puras, exportadas para tests:
  parsePresupuesto,
  matchLeadsConPropiedad,
  ensureSession,
  getSession,
  appendCommandMessage,
  getRecentCommandMessages,
  setActiveContext,
  closeSession,
  lastClosedTomorrowQueue,
};
