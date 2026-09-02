// Los chequeos de salud del ecosistema: lo que se rompe en silencio.
//
// POR QUE EXISTE (Juan, 2026-09-02, hallazgo #4 de la revision): el 2 de
// septiembre se descubrieron seis fallas, ninguna con alarma, todas porque una
// persona noto un sintoma —una conversacion muda 49 dias, 45 mensajes al vacio
// por una ventana cerrada, un aviso duplicado, cuatro avisos perdidos por el
// tope de Meta. El vigilante (scheduler/radar-watchdog.js) solo miraba la
// sesion de WAHA y la frescura del inventario.
//
// Cada chequeo de aca nace de una falla REAL de ese dia. No hay chequeos
// "por si acaso": si manana aparece otra falla silenciosa, se agrega su
// chequeo; no antes.
//
// Solo consulta y describe. Quien avisa es el vigilante; quien arregla es una
// persona. Cada funcion devuelve una lista (vacia = todo bien) y nunca lanza:
// un chequeo que revienta no puede callar a los demas.

const supabase = require("./supabase");
const memory = require("./memory");
const advisors = require("./advisors");

const HORA = 3600 * 1000;
const soloDigitos = (t) => String(t || "").replace(/\D/g, "");
const horasDesde = (iso, ahora) => (ahora.getTime() - new Date(iso).getTime()) / HORA;

// Ultimo mensaje de una conversacion, {role, content, created_at} o null.
async function ultimoMensaje(conversationId) {
  if (!supabase) {
    const ms = memory.messages.filter((m) => m.conversation_id === conversationId);
    return ms.length ? ms[ms.length - 1] : null;
  }
  const { data } = await supabase
    .from("messages").select("role, content, created_at")
    .eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(1);
  return data && data[0] ? data[0] : null;
}

async function conversacionesDe(orgId, filtro = {}) {
  if (!supabase) {
    return memory.conversations.filter((c) => c.org_id === orgId && (!filtro.modo || c.modo === filtro.modo));
  }
  let q = supabase.from("conversations").select("id, lead_id, modo").eq("org_id", orgId);
  if (filtro.modo) q = q.eq("modo", filtro.modo);
  const { data } = await q;
  return data || [];
}

async function telefonoDeLead(leadId) {
  if (!supabase) return (memory.leads.find((l) => l.id === leadId) || {}).phone || null;
  const { data } = await supabase.from("leads").select("phone").eq("id", leadId).maybeSingle();
  return data ? data.phone : null;
}

async function conversacionDeTelefono(orgId, phone) {
  const tel = soloDigitos(phone);
  if (!supabase) {
    const lead = memory.leads.find((l) => l.org_id === orgId && soloDigitos(l.phone) === tel);
    return lead ? memory.conversations.find((c) => c.lead_id === lead.id) || null : null;
  }
  const { data: lead } = await supabase.from("leads").select("id").eq("org_id", orgId).eq("phone", tel).maybeSingle();
  if (!lead) return null;
  const { data: conv } = await supabase.from("conversations").select("id").eq("lead_id", lead.id).maybeSingle();
  return conv || null;
}

// El ultimo mensaje ENTRANTE de una conversacion (created_at o null).
async function ultimoEntrante(conversationId) {
  if (!supabase) {
    const ms = memory.messages.filter((m) => m.conversation_id === conversationId && m.role === "user");
    return ms.length ? ms[ms.length - 1].created_at : null;
  }
  const { data } = await supabase
    .from("messages").select("created_at").eq("conversation_id", conversationId).eq("role", "user")
    .order("created_at", { ascending: false }).limit(1);
  return data && data[0] ? data[0].created_at : null;
}

// Mensajes salientes recientes de la org, en orden. Se filtra por org via las
// conversaciones porque messages no tiene org_id.
async function salientesRecientes(orgId, desde) {
  const convs = await conversacionesDe(orgId);
  const ids = new Set(convs.map((c) => c.id));
  if (!supabase) {
    return memory.messages
      .filter((m) => ids.has(m.conversation_id) && m.role === "assistant" && new Date(m.created_at) >= desde)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }
  if (ids.size === 0) return [];
  const { data } = await supabase
    .from("messages").select("conversation_id, content, created_at, delivery, delivery_error")
    .in("conversation_id", [...ids]).eq("role", "assistant").gte("created_at", desde.toISOString())
    .order("created_at", { ascending: true }).limit(500);
  return data || [];
}

// 1. Conversacion tomada por un asesor, con el cliente escribiendo al vacio.
// Caso real: 573245934862, en modo humano desde el 15 de julio, 30 mensajes
// seguidos sin respuesta, 49 dias. Nadie lo vio.
async function conversacionesMudas(orgId, { ahora = new Date(), horas = 2 } = {}) {
  try {
    const salida = [];
    for (const c of await conversacionesDe(orgId, { modo: "humano" })) {
      const u = await ultimoMensaje(c.id);
      if (!u || u.role !== "user") continue;
      const h = horasDesde(u.created_at, ahora);
      if (h < horas) continue;
      salida.push({ conversation_id: c.id, phone: await telefonoDeLead(c.lead_id), horas: Math.round(h) });
    }
    return salida;
  } catch (e) {
    console.warn("[salud] conversacionesMudas fallo:", e.message);
    return [];
  }
}

// 2. La ventana de 24 h de cada asesora.
// Caso real: Catherine no le escribia a Sofi desde el 25 de agosto; 45
// mensajes el 1 de septiembre se aceptaron en la API y no llegaron. Se avisa
// ANTES de que cierre (a las 20 h) para que alcance a escribir cualquier cosa.
async function ventanasAsesoras(orgId, { ahora = new Date(), horasAviso = 20 } = {}) {
  try {
    const equipo = await advisors.listElegibles(orgId, { especialidades: [] }).catch(() => []);
    const vistos = new Set();
    const salida = [];
    for (const a of equipo) {
      const tel = soloDigitos(a.phone);
      if (!tel || vistos.has(tel)) continue;
      vistos.add(tel);
      const conv = await conversacionDeTelefono(orgId, tel);
      const ultimo = conv ? await ultimoEntrante(conv.id) : null;
      const h = ultimo ? horasDesde(ultimo, ahora) : null;
      if (h !== null && h < horasAviso) continue;
      salida.push({ name: a.name, phone: tel, horas: h === null ? null : Math.round(h), cerrada: h === null || h >= 24 });
    }
    return salida;
  } catch (e) {
    console.warn("[salud] ventanasAsesoras fallo:", e.message);
    return [];
  }
}

// 3. Dos mensajes identicos al mismo numero, seguidos.
// Caso real: el aviso de David Holguin salio dos veces con 0,26 s de
// diferencia; ocho asi en 13 dias. El candado de mensaje-asesor.js los frena;
// esto avisa si algo se le escapa.
async function duplicadosRecientes(orgId, { ahora = new Date(), minutos = 60 } = {}) {
  try {
    const ms = await salientesRecientes(orgId, new Date(ahora.getTime() - minutos * 60 * 1000));
    const salida = [];
    for (let i = 1; i < ms.length; i++) {
      const a = ms[i - 1];
      const b = ms[i];
      if (a.conversation_id !== b.conversation_id || a.content !== b.content) continue;
      if (new Date(b.created_at) - new Date(a.created_at) > 120 * 1000) continue;
      salida.push({ conversation_id: b.conversation_id, texto: String(b.content).slice(0, 60) });
    }
    return salida;
  } catch (e) {
    console.warn("[salud] duplicadosRecientes fallo:", e.message);
    return [];
  }
}

// 4. Envios que Meta rechazo.
// Caso real: cuatro avisos a Natalia en cuatro minutos, "pair rate limit
// hit", nadie se entero hasta que se leyo la base.
async function fallidosRecientes(orgId, { ahora = new Date(), minutos = 60 } = {}) {
  try {
    const ms = await salientesRecientes(orgId, new Date(ahora.getTime() - minutos * 60 * 1000));
    const porError = {};
    for (const m of ms) {
      if (m.delivery !== "failed") continue;
      const k = String(m.delivery_error || "sin detalle").slice(0, 80);
      porError[k] = (porError[k] || 0) + 1;
    }
    return Object.entries(porError).map(([error, cantidad]) => ({ error, cantidad }));
  } catch (e) {
    console.warn("[salud] fallidosRecientes fallo:", e.message);
    return [];
  }
}

// 5. Pedido con algo que ofrecer y sin salida.
// Sofi encontro propiedades utiles o dudosas, y pasados N minutos no salio ni
// el DM al colega ni el aviso a la asesora. Es el unico chequeo que mira el
// radar por dentro: todo lo demas lo cubre el flujo, pero un pedido que se
// queda en el medio no lo ve nadie.
async function senalesAtascadas(orgId, { ahora = new Date(), minutos = 15, horasMax = 24 } = {}) {
  try {
    const desde = new Date(ahora.getTime() - horasMax * HORA);
    const hasta = new Date(ahora.getTime() - minutos * 60 * 1000);
    const conAlgo = (s) => {
      const r = s.revalidacion || {};
      const utiles = Array.isArray(r.refs_utiles) ? r.refs_utiles.length : 0;
      const dudosas = Array.isArray(r.refs_dudosas) ? r.refs_dudosas.length : 0;
      return utiles + dudosas > 0;
    };
    const sinSalida = (s) => !s.respondida_at && !s.aviso_wamid && !s.enviado_at;
    let filas;
    if (!supabase) {
      filas = memory.groupSignals.filter((s) => s.org_id === orgId && s.clase === "demanda");
    } else {
      const { data } = await supabase
        .from("group_signals")
        .select("id, autor_nombre, matches, revalidacion, respondida_at, aviso_wamid, enviado_at, created_at")
        .eq("org_id", orgId).eq("clase", "demanda").is("respondida_at", null)
        .gte("created_at", desde.toISOString()).lte("created_at", hasta.toISOString()).limit(200);
      filas = data || [];
    }
    return filas
      .filter((s) => new Date(s.created_at) >= desde && new Date(s.created_at) <= hasta)
      .filter((s) => (s.matches || []).length > 0 && conAlgo(s) && sinSalida(s))
      .map((s) => ({ id: s.id, autor_nombre: s.autor_nombre, minutos: Math.round((ahora - new Date(s.created_at)) / 60000) }));
  } catch (e) {
    console.warn("[salud] senalesAtascadas fallo:", e.message);
    return [];
  }
}

// Todo junto, ya redactado como problemas para el vigilante: {clave, texto}.
// La clave es estable por tipo para que el vigilante no repita el mismo aviso
// cada media hora; el texto cambia cuando cambia lo que hay que decir.
async function problemas(orgId, { ahora = new Date() } = {}) {
  const p = [];

  for (const m of await conversacionesMudas(orgId, { ahora })) {
    p.push({
      clave: `muda:${m.conversation_id}`,
      texto:
        `Un cliente (${m.phone || "sin numero"}) lleva ${m.horas} h escribiendo y nadie le contesta: la conversacion ` +
        `esta tomada por un asesor (modo humano) y Sofi calla a proposito. Devolvela a Sofi desde el CRM o que alguien le responda.`,
    });
  }

  for (const v of await ventanasAsesoras(orgId, { ahora })) {
    p.push({
      clave: `ventana:${v.phone}`,
      texto: v.cerrada
        ? `La ventana de ${v.name} esta CERRADA${v.horas ? ` (no le escribe a Sofi hace ${v.horas} h)` : " (nunca le ha escrito a Sofi)"}: ` +
          `todo lo que se le mande se acepta y no llega. Que le escriba cualquier cosa a Sofi y se reabre.`
        : `La ventana de ${v.name} cierra en ${24 - v.horas} h (no le escribe a Sofi hace ${v.horas} h). Si no escribe antes, los avisos dejan de llegarle.`,
    });
  }

  const dups = await duplicadosRecientes(orgId, { ahora });
  if (dups.length) {
    p.push({
      clave: "duplicados",
      texto: `Salieron ${dups.length} mensaje(s) repetido(s) al mismo numero en la ultima hora. Ej: "${dups[0].texto}..."`,
    });
  }

  const fallidos = await fallidosRecientes(orgId, { ahora });
  if (fallidos.length) {
    const total = fallidos.reduce((a, f) => a + f.cantidad, 0);
    p.push({
      clave: "fallidos",
      texto: `Meta rechazo ${total} envio(s) en la ultima hora: ${fallidos.map((f) => `${f.cantidad}x ${f.error}`).join(" / ")}`,
    });
  }

  for (const s of await senalesAtascadas(orgId, { ahora })) {
    p.push({
      clave: `atascada:${s.id}`,
      texto: `El pedido de ${s.autor_nombre || "un colega"} tiene propiedades que Sofi marco utiles y lleva ${s.minutos} min sin salir ni al colega ni a la asesora.`,
    });
  }

  return p;
}

module.exports = { conversacionesMudas, ventanasAsesoras, duplicadosRecientes, fallidosRecientes, senalesAtascadas, problemas };
