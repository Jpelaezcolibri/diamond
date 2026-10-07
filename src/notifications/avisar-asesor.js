// TODO AL CHAT DEL CRM (Juan, 2026-10-07; plan 2026-10-07-plan-6): "toda
// comunicacion de Sofi o de cualquier persona que escriba al numero de Sofi y
// solicite un asesor, cualquier colega o cualquier agenda se haga directamente
// al chat que se va a crear en el CRM y que desde ahi se pueda tomar control".
//
// Este es el UNICO camino para avisarle algo a un asesor:
//   1. marca el chat (leads.atencion_pendiente) y, si corresponde, se lo
//      asigna (transferido_advisor_id) — asi le aparece arriba en su Inbox;
//   2. notificacion en la app (campana + push) con link directo al chat;
//   3. por WhatsApp SOLO un aviso corto sin datos del cliente (opcion b de
//      Juan): plantilla `aviso_app`, o texto corto si la plantilla falla.
// La conversacion y las acciones (tomar control, confirmar la visita) viven
// en el CRM. El cliente siempre habla con el numero de Sofi.

const MOTIVOS = {
  pide_asesor: { atencion: true, asigna: true, tipo: "asesor_solicitado", whatsapp: "alguien pide hablar con un asesor" },
  transferido: { atencion: true, asigna: true, tipo: "transferido", whatsapp: "Sofi te transfirió un cliente" },
  visita: { atencion: true, asigna: false, tipo: "cita_por_confirmar", whatsapp: "una visita por confirmar" },
  aviso: { atencion: false, asigna: false, tipo: "aviso", whatsapp: "un aviso nuevo" },
};

function depsPorDefecto() {
  return {
    actualizarLead: (id, patch) => require("../data/leads").update(id, patch),
    conversacion: async (orgId, leadId) => {
      const conv = await require("../data/conversations").findOrCreate(orgId, leadId, null).catch(() => null);
      return conv ? conv.id : null;
    },
    notificar: (...a) => require("./notificar").notificar(...a),
    plantilla: (...a) => require("../channels/whatsapp").sendWhatsAppTemplate(...a),
    texto: (...a) => require("../channels/whatsapp").sendWhatsApp(...a),
  };
}

async function avisarAsesor({ org, advisor, motivo, lead, titulo, cuerpo = null }, deps = null) {
  if (!advisor || !advisor.id || !org) return { ok: false };
  const m = MOTIVOS[motivo] || MOTIVOS.aviso;
  const d = deps || depsPorDefecto();

  if (m.atencion && lead && lead.id) {
    const patch = { atencion_pendiente: motivo, atencion_desde: new Date().toISOString() };
    if (m.asigna) patch.transferido_advisor_id = advisor.id;
    await d.actualizarLead(lead.id, patch).catch((e) => console.warn(`[avisar-asesor] No se pudo marcar el chat (${motivo}):`, e.message));
  }

  const convId = lead && lead.id ? await d.conversacion(org.id, lead.id).catch(() => null) : null;
  await d
    .notificar({ orgId: org.id, advisor, tipo: m.tipo, titulo, cuerpo, link: convId ? `/inbox/${convId}` : "/pendientes", leadId: lead ? lead.id : null })
    .catch(() => {});

  const tel = String(advisor.phone || "").replace(/\D/g, "");
  let whatsapp = false;
  if (tel) {
    const r = await d.plantilla(org, tel, { name: "aviso_app", bodyParams: [m.whatsapp] }).catch((e) => ({ ok: false, error: e.message }));
    if (r && r.ok) whatsapp = true;
    else {
      const t = await d
        .texto(org, tel, `Tenés un pendiente en la app de Diamond: ${m.whatsapp}. Entrá a la app para atenderlo: crm.diamondinmobiliaria.com/pendientes`)
        .catch((e) => ({ ok: false, error: e.message }));
      whatsapp = Boolean(t && t.ok);
    }
  }
  return { ok: true, whatsapp };
}

module.exports = { avisarAsesor, MOTIVOS };
