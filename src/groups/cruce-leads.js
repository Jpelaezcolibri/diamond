// Una oferta nueva de un colega, cruzada contra los leads propios que la
// estan esperando — sin gastar un token: es una consulta en base, no una
// busqueda con IA.
//
// POR QUE EXISTE. La red de aliados ya se consulta cuando un CLIENTE pregunta
// y no hay inventario propio (src/agent/tools.js, buscar_propiedades). Eso es
// reactivo: alguien tiene que preguntar primero. Esto es lo inverso — la
// oferta acaba de entrar por el radar (src/groups/ofertas.js) y puede haber
// un lead activo esperando exactamente eso, asi que el aviso sale ANTES de
// que nadie pregunte.
//
// Reutiliza el mismo motor de match que ya usa el Centro de Comando
// (matchLeadsConPropiedad, propiedad -> leads, en src/data/command.js) y el
// mismo dedup por (ally_property_id, lead_id) que usa el camino reactivo
// (tabla ally_property_alerts): si ese cliente ya habia preguntado y ya se le
// aviso al asesor por la otra via, esto no le manda un segundo mensaje.

const command = require("../data/command");
const allyProperties = require("../data/ally-properties");
const advisors = require("../data/advisors");
const { buildAllyOfferMatchAlert } = require("../notifications/advisor");
const canalWhatsapp = require("../channels/whatsapp");

// Hasta donde vale la pena mirar: si una oferta generica (apartamento en
// Laureles) encaja con medio CRM, avisarle a 40 asesores no es un cruce
// util, es spam interno.
const LIMITE_LEADS = 5;

// Este cruce lo dispara el radar, no un asesor mirando su bandeja: no hay
// viewer al que acotar, hace falta ver TODOS los leads activos de la org.
function scopeOrg(orgId) {
  return { orgId, viewerUid: null, isAdmin: true };
}

// A quien avisar: primero el dueno del lead (es su cliente, su comision).
// Si el lead todavia no tiene dueno asignado, el asesor puente que vio la
// oferta en el grupo — es quien tiene la relacion con ese colega y puede
// preguntar por el.
async function advisorParaAvisar(orgId, lead, allyProperty) {
  if (lead.owner_id) {
    const dueño = await advisors.findByAuthUserId(orgId, lead.owner_id);
    if (dueño) return dueño;
  }
  if (allyProperty.puente_advisor_id) {
    return advisors.findById(orgId, allyProperty.puente_advisor_id);
  }
  return null;
}

/**
 * @param org           organizacion resuelta
 * @param allyProperty  la fila que devolvio guardarOferta (null si la oferta
 *                       no era utilizable — se ignora sin error)
 */
async function cruzarOfertaConLeads(org, allyProperty) {
  if (!allyProperty || !allyProperty.id) return { resultado: "sin_oferta", avisados: [] };

  const candidatos = await command.leadsParaPropiedad(scopeOrg(org.id), allyProperty, LIMITE_LEADS);
  if (candidatos.length === 0) return { resultado: "sin_leads_esperando", avisados: [] };

  const avisados = [];
  for (const lead of candidatos) {
    // Dedup real ANTES de resolver asesor o redactar nada: es la misma tabla
    // que usa el camino reactivo, asi que un lead que ya pregunto por esto y
    // ya recibio el aviso por la otra via no recibe un segundo mensaje.
    const esNuevo = await allyProperties.registerAlert(org.id, allyProperty.id, lead.lead_id);
    if (!esNuevo) continue;

    const advisor = await advisorParaAvisar(org.id, lead, allyProperty);
    if (!advisor || !advisor.phone) continue;

    const texto = buildAllyOfferMatchAlert(allyProperty, lead);
    const envio = await canalWhatsapp
      .sendWhatsApp(org, advisor.phone, texto)
      .catch((e) => ({ ok: false, error: e.message }));
    if (envio && envio.ok) avisados.push({ leadId: lead.lead_id, advisorPhone: advisor.phone });
    else console.warn(`[radar] No se pudo avisar del cruce oferta-lead a ${advisor.phone}: ${envio && envio.error}`);
  }

  return { resultado: avisados.length > 0 ? "avisados" : "sin_destinatario", avisados };
}

module.exports = { cruzarOfertaConLeads, advisorParaAvisar, LIMITE_LEADS };
