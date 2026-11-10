// La ficha completa de una visita para la ASESORA (uso interno). Juan,
// 2026-11-09: "valida que siempre pueda ver la información tanto del colega que
// escribe como de la propiedad que estamos ofreciendo más los datos para
// contactar a dicho colega o cliente". Caso Norha Vélez: Catherine confirmó una
// visita con un WhatsApp que solo decía "tienes una visita por confirmar"; no
// supo quién era ni cómo contactarla.
//
// textoVisitaAsesora es puro (se prueba sin base); armarFichaVisita junta los
// datos (propiedad, pedido del colega, preguntas abiertas, link al chat) y
// nunca lanza: lo que no encuentra, no sale.
const { formatCitaFechaHora } = require("../notifications/advisor");
const { celularDe } = require("./quien-lead");

function celularLegible(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("57")) return `+57 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  return d.length >= 8 ? `+${d}` : null;
}

function cuandoLegible(iso) {
  const fh = formatCitaFechaHora(iso);
  return fh ? `${fh.fecha} · ${fh.hora}` : "fecha por definir";
}

function lineaPropiedad(p, ref) {
  if (!p) return [`*Propiedad:* Ref ${ref || "sin ref"} (no encontré la ficha en la base: revísala en Wasi).`];
  const tipoOp = [p.tipo, p.operacion ? `en ${String(p.operacion).toLowerCase()}` : null].filter(Boolean).join(" ");
  const cabeza = [`Ref ${p.ref || ref}`, tipoOp || null, [p.zona, p.ciudad].filter(Boolean).join(", ") || null].filter(Boolean).join(" · ");
  const hab = p.habitaciones ?? p.alcobas;
  const garaje = p.garaje ?? p.parqueaderos;
  const datos = [
    p.precio,
    p.area,
    hab != null ? `${hab} habitaciones` : null,
    p.banos != null ? `${p.banos} baños` : null,
    garaje != null ? `${garaje} parqueadero${Number(garaje) === 1 ? "" : "s"}` : null,
    p.estrato ? `estrato ${p.estrato}` : null,
  ].filter(Boolean).join(" · ");
  const link = p.linkWasi || null;
  return [`*Propiedad:* ${cabeza}`, datos || null, link ? `Ficha: ${link}` : "Ficha: sin link de Wasi registrado"].filter(Boolean);
}

function textoVisitaAsesora({ lead, cita, propiedad = null, pedido = null, colega = null, preguntas = [], chatUrl = null }) {
  const c = cita || (lead && lead.cita) || {};
  const confirmada = !c.estado || c.estado === "confirmada";
  const estado = confirmada
    ? `✅ *Visita CONFIRMADA* · ${cuandoLegible(c.fecha_hora)}`
    : `⏳ *Visita POR CONFIRMAR* · ${cuandoLegible(c.fecha_hora)}${c.corte_at ? `\nConfírmala antes de ${cuandoLegible(c.corte_at).replace(" · ", ", ")} o se cancela.` : ""}`;

  const esColega = lead && lead.source === "colega";
  const nombre = String((lead && lead.nombre) || (colega && colega.nombre) || "").trim() || (esColega ? "Colega sin nombre registrado" : "Cliente sin nombre registrado");
  const quien = `*Quién va:* ${nombre} — ${esColega ? "colega de otra inmobiliaria, viene con un cliente suyo" : "cliente directo"}`;

  // El celular que dejó en el chat cuenta igual que el de su WhatsApp (caso Norha).
  const d = celularDe(lead);
  const contacto = d
    ? `*Contacto:* ${celularLegible(d)} · WhatsApp: wa.me/${d}`
    : "*Contacto:* Sin celular visible (WhatsApp lo oculta). Escríbele desde el chat del CRM y pídele un número de celular para poder llamar.";

  const partes = [estado, "", ...lineaPropiedad(propiedad, c.ref), "", quien, contacto];
  if (pedido && pedido.texto_original) {
    const donde = pedido.grupo ? ` (grupo ${pedido.grupo})` : "";
    partes.push("", `*Qué pidió${donde}:* "${String(pedido.texto_original).replace(/\s+/g, " ").trim().slice(0, 400)}"`);
  }
  const abiertas = (preguntas || []).filter(Boolean);
  if (abiertas.length) partes.push("", "*Pendiente por responderle:*", ...abiertas.map((q) => `• ${q}`));
  if (chatUrl) partes.push("", `*Chat:* ${chatUrl}`);
  return partes.join("\n");
}

function depsPorDefecto() {
  return {
    propiedad: (org, ref) => require("../data/properties").findByRef(org, String(ref)),
    colega: (orgId, phone) => require("../data/colegas").porTelefono(orgId, String(phone || "").replace(/\D/g, "")),
    pedidoPorLid: (orgId, lid) => require("../data/group-signals").buscarPorLid(orgId, lid),
    pedidoPorTelefono: (orgId, tel) => require("../data/group-signals").buscarPorTelefono(orgId, tel),
    grupo: async (groupId) => {
      const supabase = require("../data/supabase");
      if (!supabase || !groupId) return null;
      const { data } = await supabase.from("whatsapp_groups").select("nombre").eq("id", groupId).maybeSingle();
      return (data && data.nombre) || null;
    },
    preguntas: async (orgId, leadId) => {
      const lista = await require("../data/preguntas-asesor").pendientesDeOrg(orgId);
      return (lista || []).filter((p) => p.lead_id === leadId).map((p) => p.pregunta);
    },
    conversacion: async (orgId, leadId) => {
      const conv = await require("../data/conversations").findOrCreate(orgId, leadId, null);
      return conv ? conv.id : null;
    },
    crmUrl: () => String(process.env.CRM_PUBLIC_URL || "").trim().replace(/\/$/, "") || null,
  };
}

async function armarFichaVisita({ org, lead, cita = null, deps = null }) {
  const d = { ...depsPorDefecto(), ...(deps || {}) };
  const c = cita || (lead && lead.cita) || {};
  const nada = () => null;
  const propiedad = c.ref ? await d.propiedad(org, c.ref).catch(nada) : null;
  let colega = null;
  let pedido = null;
  if (lead && lead.source === "colega") {
    colega = await d.colega(org.id, lead.phone).catch(nada);
    const digitos = String(lead.phone || "").replace(/\D/g, "");
    // colegas_grupos guarda el lid sin sufijo; group_signals, con "@lid".
    const lid = colega && colega.lid ? String(colega.lid).replace(/@lid$/, "") : null;
    pedido = (lid ? await d.pedidoPorLid(org.id, `${lid}@lid`).catch(nada) : null)
      || (lid ? await d.pedidoPorLid(org.id, lid).catch(nada) : null)
      || (digitos ? await d.pedidoPorTelefono(org.id, digitos).catch(nada) : null);
    if (pedido && !pedido.grupo && pedido.group_id) pedido = { ...pedido, grupo: await d.grupo(pedido.group_id).catch(nada) };
  }
  const preguntas = lead && lead.id ? await d.preguntas(org.id, lead.id).catch(() => []) : [];
  const base = d.crmUrl();
  const convId = base && lead && lead.id ? await d.conversacion(org.id, lead.id).catch(nada) : null;
  return textoVisitaAsesora({ lead, cita: c, propiedad, pedido, colega, preguntas, chatUrl: base && convId ? `${base}/inbox/${convId}` : null });
}

module.exports = { textoVisitaAsesora, armarFichaVisita, celularLegible };
