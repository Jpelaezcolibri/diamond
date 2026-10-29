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
  // No asigna: el round-robin de transferencias vive en transferido_advisor_id
  // (data/advisors.js) y esto no es una transferencia (scheduler/sin-respuesta.js).
  sin_respuesta: { atencion: true, asigna: false, tipo: "sin_respuesta", whatsapp: "alguien que no le contestó a Sofi y hay que contactar" },
  pregunta: { atencion: false, asigna: false, tipo: "pregunta_asesor", whatsapp: "una pregunta de un colega" },
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

async function avisarAsesor({ org, advisor, motivo, lead, titulo, cuerpo = null, whatsapp: mandarWhatsApp = true }, deps = null) {
  if (!advisor || !advisor.id || !org) return { ok: false, error: "sin asesora con usuario" };
  // Un asesor dado de baja no recibe nada (2026-10-21: Natalia, inactiva,
  // comparte el 8024 con la linea 2 de Daiana).
  if (advisor.activo === false) return { ok: false, error: "asesor dado de baja" };
  const m = MOTIVOS[motivo] || MOTIVOS.aviso;
  const d = deps || depsPorDefecto();

  if (m.atencion && lead && lead.id) {
    const patch = { atencion_pendiente: motivo, atencion_desde: new Date().toISOString() };
    if (m.asigna) patch.transferido_advisor_id = advisor.id;
    await d.actualizarLead(lead.id, patch).catch((e) => console.warn(`[avisar-asesor] No se pudo marcar el chat (${motivo}):`, e.message));
  }

  const convId = lead && lead.id ? await d.conversacion(org.id, lead.id).catch(() => null) : null;
  const n = await d
    .notificar({ orgId: org.id, advisor, tipo: m.tipo, titulo, cuerpo, link: convId ? `/inbox/${convId}` : "/pendientes", leadId: lead ? lead.id : null })
    .catch((e) => ({ ok: false, push: 0, error: e.message }));
  const campana = Boolean(n && n.ok);
  const push = (n && Number(n.push)) || 0;

  const tel = String(advisor.phone || "").replace(/\D/g, "");
  let whatsapp = false;
  if (tel && mandarWhatsApp) {
    const r = await d.plantilla(org, tel, { name: "aviso_app", bodyParams: [m.whatsapp] }).catch((e) => ({ ok: false, error: e.message }));
    if (r && r.ok) whatsapp = true;
    else {
      const t = await d
        .texto(org, tel, `Tenés un pendiente en la app de Diamond: ${m.whatsapp}. Entrá a la app para atenderlo: crm.diamondinmobiliaria.com/pendientes`)
        .catch((e) => ({ ok: false, error: e.message }));
      whatsapp = Boolean(t && t.ok);
    }
  }
  // `ok` = le llego algo EN TIEMPO REAL (revision 2026-10-21): push a por lo
  // menos un dispositivo o el WhatsApp. La campana sola no cuenta: solo la ve
  // quien tenga el CRM abierto (Daiana y Catherine tienen 0 dispositivos de
  // push), y con ese `ok` Sofi se pausaba sin que nadie se enterara.
  const ok = push > 0 || whatsapp;
  const r = { ok, campana, push, whatsapp };
  if (!ok) r.error = `no le llegó por push ni por WhatsApp${campana ? " (quedó solo en la campana del CRM)" : " (ni siquiera quedó en la campana)"}`;
  return r;
}

// Envoltorio para los avisos que arma tools.js ({advisor, advisorAlert, ...}):
// el captador, el match de aliado y la cita fuera de la rotacion (2026-10-21).
// Antes salian como texto libre por WhatsApp con los datos del cliente; ahora
// el texto completo va al cuerpo de la campana (dentro del CRM) y por WhatsApp
// solo sale aviso_app. Nunca lanza. Con `alertaTecnicaSiFalla` (la cita), si no
// hay asesora con id a quien avisar o el aviso no le llego en tiempo real (ni
// push ni WhatsApp), Juan recibe una alerta tecnica sin datos del cliente.
async function avisarPorCampana({ org, alerta, motivo, lead, titulo, que = "aviso", alertaTecnicaSiFalla = false }, deps = null) {
  if (!alerta) return { ok: false };
  const advisor = alerta.advisor || (alerta.advisorId ? { id: alerta.advisorId, name: alerta.advisorName || null, phone: alerta.advisorPhone || null } : null);
  const r = await module.exports.avisarAsesor({ org, advisor, motivo, lead, titulo, cuerpo: alerta.advisorAlert || null }, deps ? deps.avisar : null).catch((e) => ({
    ok: false,
    error: e.message,
  }));
  if (r && r.ok) return r;
  const quien = (advisor && (advisor.name || advisor.id)) || "nadie";
  const error = (r && r.error) || "sin asesora con usuario";
  console.error(`[avisar-asesor] Aviso de ${que} a ${quien} NO le llegó en tiempo real:`, error);
  if (alertaTecnicaSiFalla) {
    const alertaTecnica = (deps && deps.alertaTecnica) || require("../lib/alerta-saldo").enviarAlertaTecnica;
    const conAsesora = Boolean(advisor && advisor.id && r && "campana" in r);
    await Promise.resolve(
      alertaTecnica(
        conAsesora ? `Aviso de ${que} sin entregar: lead ${(lead && lead.id) || "?"}.` : `Aviso de ${que} sin asesora: lead ${(lead && lead.id) || "?"}.`,
        conAsesora
          ? `${error}. Revisar "Para atender" del CRM ${(org && org.name) || ""}.`
          : `No hay asesora activa a quien avisarle. Revisar "Para atender" del CRM ${(org && org.name) || ""}.`
      )
    ).catch(() => {});
  }
  return r || { ok: false };
}

module.exports = { avisarAsesor, avisarPorCampana, MOTIVOS };
