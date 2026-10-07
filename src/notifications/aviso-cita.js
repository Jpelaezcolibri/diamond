// Aviso de cita por confirmar (spec 2026-10-07 §4.4): plantilla de Meta con
// botones Confirmar / Otro horario, que llega aunque la ventana de 24 h este
// cerrada. Si la plantilla falla (no aprobada, error de Meta), cae al texto de
// siempre con respaldo (entregarConRespaldo: el 8024 para Asesor 1).
const { formatCitaFechaHora } = require("./advisor");

function cuando(iso) {
  const fh = formatCitaFechaHora(iso);
  return fh ? `${fh.fecha}, ${fh.hora}` : "por definir";
}

async function avisarCitaPorConfirmar({ org, advisor, lead, cita, deps = {} }) {
  // Requires tardios: whatsapp.js y entrega-asesor.js arrastran engine.js.
  const plantilla = deps.plantilla || ((...a) => require("../channels/whatsapp").sendWhatsAppTemplate(...a));
  const respaldo = deps.respaldo || ((...a) => require("../lib/entrega-asesor").entregarConRespaldo(...a));
  const notificar = deps.notificar || ((...a) => require("./notificar").notificar(...a));
  const tel = String((advisor && advisor.phone) || "").replace(/\D/g, "");
  const quien = `${lead.nombre || `+${lead.phone}`}${lead.source === "colega" ? " (colega)" : ""}`;
  const params = [cita.ref || "sin ref", cuando(cita.fecha_hora), quien, cuando(cita.corte_at)];

  const r = await plantilla(org, tel, {
    name: "cita_por_confirmar",
    bodyParams: params,
    buttonPayloads: [`cita:${lead.id}:confirmar`, `cita:${lead.id}:otro`],
  }).catch((e) => ({ ok: false, error: e.message }));
  // Campana y push de la app (2026-10-07), salga o no la plantilla.
  await notificar({
    orgId: org && org.id, advisor, tipo: "cita_por_confirmar", titulo: "Nueva visita por confirmar",
    cuerpo: `Ref ${params[0]} · ${params[1]} · ${params[2]}`, link: "/pendientes", leadId: lead.id,
  }).catch(() => {});
  if (r && r.ok) return { ok: true, via: "plantilla" };

  console.warn(`[aviso-cita] La plantilla no salio a ${advisor && advisor.name}: ${r && r.error}. Va por texto.`);
  const texto = [
    `📅 Nueva visita por confirmar`,
    `Propiedad: ref ${params[0]}`,
    `Fecha y hora: ${params[1]}`,
    `Solicitada por: ${params[2]}`,
    `Si no se confirma antes de ${params[3]}, se cancela.`,
    ``,
    `Respondé *OK CONFIRMADA* para confirmarla.`,
  ].join("\n");
  const t = await respaldo(org, advisor, texto).catch((e) => ({ ok: false, error: e.message }));
  return t && t.ok ? { ok: true, via: "texto" } : { ok: false, via: "texto", error: t && t.error };
}

module.exports = { avisarCitaPorConfirmar };
