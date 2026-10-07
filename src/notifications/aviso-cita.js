// Aviso de cita por confirmar (spec 2026-10-07 §4.4, y plan 6 "todo al chat
// del CRM"). La visita se atiende en el chat del CRM: queda marcada en ese
// chat (atencion_pendiente = "visita"), el asesor recibe la notificacion en la
// app con link al chat, y por WhatsApp solo el aviso corto sin datos
// (avisar-asesor.js). La confirmacion se hace en la tarjeta del chat; el boton
// de la plantilla vieja cita_por_confirmar y "OK CONFIRMADA" siguen sirviendo.
const { formatCitaFechaHora } = require("./advisor");

function cuando(iso) {
  const fh = formatCitaFechaHora(iso);
  return fh ? `${fh.fecha}, ${fh.hora}` : "por definir";
}

async function avisarCitaPorConfirmar({ org, advisor, lead, cita, deps = {} }) {
  const avisar = deps.avisar || ((...a) => require("./avisar-asesor").avisarAsesor(...a));
  const quien = `${lead.nombre || `+${lead.phone}`}${lead.source === "colega" ? " (colega)" : ""}`;
  const cuerpo = `Ref ${cita.ref || "sin ref"} · ${cuando(cita.fecha_hora)} · ${quien} · confirmá antes de ${cuando(cita.corte_at)}`;
  const r = await avisar({ org, advisor, motivo: "visita", lead, titulo: "Nueva visita por confirmar", cuerpo }).catch((e) => ({
    ok: false,
    error: e.message,
  }));
  return r && r.ok ? { ok: true, via: "app" } : { ok: false, via: "app", error: r && r.error };
}

module.exports = { avisarCitaPorConfirmar };
