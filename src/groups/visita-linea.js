// Interes o visita de un colega en la LINEA DEL RADAR (Juan, 2026-10-20: "que
// cada interes o visita le llegue a Daiana en la campana del CRM, y que quede
// como cita en el sistema").
//
// Por que existe: en 30 dias 48 colegas respondieron 146 veces a los DM del
// radar en la linea de Daiana ("¿en que sector queda?", "el cliente me
// confirmo para la una pm") y el sistema no registro ni una visita: el
// detector estaba apagado y, prendido, avisaba por WhatsApp. La conversacion
// sigue siendo de Daiana en su linea; esto solo la avisa y lo deja asentado.
//
// - Aviso: campana del CRM (+ push) a la asesora duena de la linea.
// - Cita: si el colega esta agendando (propuesta) o ya quedo (confirmada),
//   queda en leads.cita del colega con origen "linea_dm": aparece en Para
//   atender y en el calendario, y la escalera de rotacion NO la toca (la
//   coordina Daiana, no se rota a otras asesoras).
const leads = require("../data/leads");
const advisors = require("../data/advisors");
const whatsappGroups = require("../data/whatsapp-groups");
const notif = require("../notifications/notificar");

const ORIGEN = "linea_dm";

const TITULOS = {
  cita_confirmada: "📅 Visita confirmada con un colega",
  agendando: "🗓️ Un colega quiere agendar visita",
  interes_avanzado: "🔥 Colega interesado en una propiedad",
};

async function asesoraDeLinea(org, nombreSesion) {
  const sesion = await whatsappGroups.sesionPorNombre(org.id, nombreSesion).catch(() => null);
  if (sesion && sesion.advisor_id) {
    const a = await advisors.findById(org.id, sesion.advisor_id).catch(() => null);
    if (a && a.activo !== false) return a;
  }
  return advisors.findAsesorPrincipalRadar(org).catch(() => null);
}

function refDe(señal) {
  const refs = (señal && (señal.respuesta_refs || señal.aviso_refs)) || [];
  return refs.length ? String(refs[0]) : null;
}

function cuandoDe(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return d.toLocaleString("es-CO", { timeZone: "America/Bogota", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });
}

/**
 * @returns { ok, motivo?, leadId? } — ok=false con motivo "sin_asesora" si no
 *          hay a quien avisar. Nunca lanza.
 */
async function avisar(org, { mensaje, veredicto, señal, identidad }) {
  const advisor = await asesoraDeLinea(org, mensaje.sesion);
  if (!advisor) return { ok: false, motivo: "sin_asesora" };

  const ref = refDe(señal);
  const colega = mensaje.remitenteNombre || mensaje.remitenteTelefono || "Un colega";
  const esVisita = veredicto.tipo === "cita_confirmada" || veredicto.tipo === "agendando";

  let leadId = null;
  if (esVisita) {
    try {
      const phone = identidad.telefono || identidad.lid;
      const lead = await leads.findOrCreate(org.id, phone, "colega");
      const ahora = new Date().toISOString();
      const confirmada = veredicto.tipo === "cita_confirmada";
      const cita = {
        tipo: "visita",
        estado: confirmada ? "confirmada" : "propuesta",
        fecha_hora: veredicto.fecha_hora_iso || null,
        descripcion: veredicto.resumen || null,
        ref,
        asesor_id: advisor.id,
        advisor_id: advisor.auth_user_id || null,
        origen: ORIGEN,
        creada_at: ahora,
        ...(confirmada ? { confirmada_at: ahora, confirmada_por: "colega, en la linea" } : {}),
      };
      await leads.update(lead.id, { cita, ...(!lead.nombre && mensaje.remitenteNombre ? { nombre: mensaje.remitenteNombre } : {}) });
      leadId = lead.id;
    } catch (e) {
      console.warn("[visita-linea] No se pudo dejar la cita:", e.message);
    }
  }

  const cuerpo = [
    colega,
    cuandoDe(veredicto.fecha_hora_iso),
    ref ? `ref ${ref}` : null,
    veredicto.resumen || null,
  ].filter(Boolean).join(" · ");
  const r = await notif
    .notificar({
      orgId: org.id,
      advisor,
      tipo: esVisita ? "visita_colega" : "interes_colega",
      titulo: TITULOS[veredicto.tipo] || "🔔 Avance de un colega en tu línea",
      cuerpo: `${cuerpo}. Respóndele por tu línea.`,
      link: esVisita ? "/pendientes" : "/grupos",
      leadId,
    })
    .catch((e) => ({ ok: false, error: e.message }));
  return { ok: Boolean(r && r.ok), leadId, error: r && r.error };
}

module.exports = { avisar, asesoraDeLinea, ORIGEN };
