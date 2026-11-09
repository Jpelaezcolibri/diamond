// Aviso de cita por confirmar (spec 2026-10-07 §4.4, y plan 6 "todo al chat
// del CRM"). La visita se atiende en el chat del CRM: queda marcada en ese
// chat (atencion_pendiente = "visita"), el asesor recibe la notificacion en la
// app con link al chat, y por WhatsApp solo el aviso corto sin datos
// (avisar-asesor.js). La confirmacion se hace en la tarjeta del chat; el boton
// de la plantilla vieja cita_por_confirmar y "OK CONFIRMADA" siguen sirviendo.
const { formatCitaFechaHora } = require("./advisor");
const { quienDe, sinCelular, AVISO_SIN_CELULAR } = require("../lib/quien-lead");

function cuando(iso) {
  const fh = formatCitaFechaHora(iso);
  return fh ? `${fh.fecha}, ${fh.hora}` : "por definir";
}

async function avisarCitaPorConfirmar({ org, advisor, lead, cita, deps = {} }) {
  const avisar = deps.avisar || ((...a) => require("./avisar-asesor").avisarAsesor(...a));
  const quien = `${quienDe(lead)}${lead.source === "colega" ? " (colega)" : ""}`;
  const oculto = sinCelular(lead.phone) ? ` · ${AVISO_SIN_CELULAR}` : "";
  const cuerpo = `Ref ${cita.ref || "sin ref"} · ${cuando(cita.fecha_hora)} · ${quien} · Confirmar antes de ${cuando(cita.corte_at)}${oculto}`;
  // La ficha completa va por WhatsApp a la asesora (caso Norha, 2026-11-09).
  const ficha = deps.ficha || ((a) => require("../lib/ficha-visita").armarFichaVisita(a));
  const detalle = await ficha({ org, lead, cita }).catch((e) => {
    console.warn("[aviso-cita] No se pudo armar la ficha de la visita:", e.message);
    return null;
  });
  const r = await avisar({ org, advisor, motivo: "visita", lead, titulo: "Nueva visita por confirmar", cuerpo, detalle }).catch((e) => ({
    ok: false,
    error: e.message,
  }));
  // `ok` = le llego en tiempo real (push o WhatsApp); `campana` = quedo en el CRM.
  const campana = Boolean(r && r.campana);
  return r && r.ok ? { ok: true, via: "app", campana } : { ok: false, via: "app", campana, error: r && r.error };
}

module.exports = { avisarCitaPorConfirmar };
