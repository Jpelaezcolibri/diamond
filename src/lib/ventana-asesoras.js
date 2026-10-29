// ¿A que asesora se le puede escribir texto libre ahora? WhatsApp solo entrega
// texto libre dentro de las 24 h desde el ultimo mensaje de ELLA a Sofi; fuera
// de eso falla con 131047 (caso 2026-10-29: 39 de 59 avisos a Claudia y
// Catherine fallaron). Mismo camino que scheduler/ventana-asesora.js: su lead
// "asesor" -> su conversacion -> ¿mensaje entrante en las ultimas 24 h?
const VENTANA_MS = 24 * 60 * 60 * 1000;

async function ventanaAbierta(org, advisor, ahora = new Date()) {
  const tel = String((advisor && advisor.phone) || "").replace(/\D/g, "");
  if (!tel) return false;
  const lead = await require("../data/leads").findOrCreate(org.id, tel, "asesor");
  const conversations = require("../data/conversations");
  const conv = await conversations.findOrCreate(org.id, lead.id, null);
  return conversations.hayMensajeEntranteDespues(conv.id, new Date(ahora.getTime() - VENTANA_MS).toISOString());
}

// Las del ciclo con la ventana abierta, en el orden del ciclo. Un error al
// consultar cuenta como cerrada: mejor campana que un texto que no llega.
async function conVentana(org, ciclo, { ahora = new Date(), abierta = ventanaAbierta } = {}) {
  const out = [];
  for (const a of ciclo || []) if (await abierta(org, a, ahora).catch(() => false)) out.push(a);
  return out;
}

module.exports = { ventanaAbierta, conVentana };
