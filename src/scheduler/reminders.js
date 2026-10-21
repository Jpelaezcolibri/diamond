// Recordatorios de cita al asesor: temporizador in-process (no hay cron/worker
// en este bot). Cada N minutos busca las citas que caen en la proxima ventana
// (~1h) y le manda al asesor DUENO de la cita la plantilla aprobada de
// WhatsApp. Marca cada cita como avisada para no repetir.
//
// Tolerante a reinicios: en cada tick re-evalua la ventana contra la base, asi
// que un tick perdido por un redeploy solo hace que el aviso salga unos minutos
// mas tarde, nunca duplicado (el flag recordatorio_enviado vive en leads.cita).
const config = require("../config");
const organizations = require("../data/organizations");
const advisors = require("../data/advisors");
const leads = require("../data/leads");
const appointments = require("../data/appointments");
const { sendWhatsAppTemplate } = require("../channels/whatsapp");

const TIPO_LABEL = { visita: "visita", llamada: "llamada", asesoria: "asesoría" };

function tipoLabel(t) {
  return TIPO_LABEL[t] || "cita";
}

function horaBogota(iso) {
  try {
    return new Date(iso).toLocaleTimeString("es-CO", {
      timeZone: "America/Bogota",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "";
  }
}

// Sin telefono: la plantilla no lo pide y el celular del cliente no sale.
function clienteDe(lead) {
  return lead.nombre || (lead.source === "colega" ? "un colega" : "un cliente");
}

// Los 4 valores del cuerpo de la plantilla recordatorio_cita, en orden:
// {{1}} asesor, {{2}} tipo, {{3}} cliente, {{4}} hora.
function reminderParams(advisor, lead) {
  return [
    advisor.name || "asesor",
    tipoLabel(lead.cita.tipo),
    clienteDe(lead),
    horaBogota(lead.cita.fecha_hora),
  ];
}

// Recordatorio de una cita de la ROTACION (brief citas-avisos §2, Juan
// 2026-10-21): a la asesora que la confirmo o la tiene asignada
// (cita.asesor_id -> advisors), por la campana del CRM y por la plantilla
// recordatorio_cita. Una sola vez: recordatorio_asesor_at se marca antes de
// enviar, asi un fallo de WhatsApp no duplica la campana.
async function recordarRotacion({ org, lead, d, nowMs }) {
  const advisor = await d.asesor(org.id, lead.cita.asesor_id).catch(() => null);
  if (!advisor || advisor.activo === false) return false;
  const cita = { ...lead.cita, recordatorio_asesor_at: new Date(nowMs).toISOString() };
  await d.actualizar(lead.id, { cita });
  lead.cita = cita;
  const hora = horaBogota(cita.fecha_hora);
  await d
    .notificar({
      orgId: org.id, advisor, tipo: "cita_recordatorio",
      titulo: `En 1 h: ${tipoLabel(cita.tipo)} con ${clienteDe(lead)}${cita.ref ? ` (Ref ${cita.ref})` : ""}`,
      cuerpo: `Hoy a las ${hora}`, link: "/calendario", leadId: lead.id,
    })
    .catch(() => {});
  const tel = String(advisor.phone || "").replace(/\D/g, "");
  if (tel) {
    const r = await d
      .plantilla(org, tel, { name: config.reminders.templateName, language: config.reminders.templateLang, bodyParams: reminderParams(advisor, lead) })
      .catch((e) => ({ ok: false, error: e.message }));
    if (!r || !r.ok) console.warn(`[reminders] recordatorio_cita a ${advisor.name} no salio (queda la campana):`, (r && r.error) || "?");
  }
  return true;
}

function depsPorDefecto() {
  return {
    asesor: (orgId, id) => advisors.findById(orgId, id),
    actualizar: (id, patch) => leads.update(id, patch),
    notificar: (...a) => require("../notifications/notificar").notificar(...a),
    plantilla: (...a) => sendWhatsAppTemplate(...a),
  };
}

let corriendo = false;
async function runOnce({ deps = null, nowMs = null } = {}) {
  if (!config.reminders.enabled) return { sent: 0 };
  if (corriendo) return { sent: 0 };
  corriendo = true;
  try {
    return await correr({ d: { ...depsPorDefecto(), ...(deps || {}) }, nowMs: nowMs == null ? Date.now() : nowMs });
  } finally {
    corriendo = false;
  }
}

async function correr({ d, nowMs }) {

  // Antes solo se procesaba organizations.getDefault() (la primera org): el
  // dia que exista una org #2 sus recordatorios de cita nunca corrian.
  const orgs = await organizations.listActive();

  let sent = 0;
  for (const org of orgs) {
    const due = await appointments.dueReminders(org.id, { windowMin: config.reminders.windowMin, nowMs });
    for (const lead of due) {
      try {
        const advisor = await advisors.findByAuthUserId(org.id, lead.cita.advisor_id);
        if (!advisor || !advisor.phone) continue;

        // Claim atomico ANTES de enviar (ver src/data/leads.js#claimAppointmentReminder):
        // si dos ticks corrieran a la vez, solo uno gana el claim — el otro se
        // salta este lead en vez de mandar el mismo recordatorio dos veces.
        const claimed = await leads.claimAppointmentReminder(lead.id);
        if (!claimed) continue; // otro tick/proceso ya lo esta manejando

        const { ok } = await d.plantilla(org, advisor.phone, {
          name: config.reminders.templateName,
          language: config.reminders.templateLang,
          bodyParams: reminderParams(advisor, lead),
        });
        if (ok) {
          sent++;
        } else {
          // Revertir el claim: si la plantilla aun no esta aprobada (o el
          // envio falla), se reintenta en el proximo tick en vez de quedar
          // marcado como enviado sin haberlo estado de verdad.
          await leads.update(lead.id, { cita: { ...lead.cita, recordatorio_enviado: false } });
        }
      } catch (e) {
        console.error("[reminders] error con lead", lead.id, e.message);
      }
    }
  }
  let rotacion = 0;
  for (const org of orgs) {
    const due = await appointments.dueRecordatoriosRotacion(org.id, { windowMin: config.reminders.windowMin, nowMs }).catch((e) => {
      console.error("[reminders] citas de la rotacion:", e.message);
      return [];
    });
    for (const lead of due) {
      try {
        if (await recordarRotacion({ org, lead, d, nowMs })) rotacion++;
      } catch (e) {
        console.error("[reminders] error con lead", lead.id, e.message);
      }
    }
  }
  if (sent || rotacion) console.log(`[reminders] ${sent} recordatorio(s) enviado(s), ${rotacion} de la rotacion`);
  return { sent, rotacion };
}

function start() {
  if (!config.reminders.enabled) {
    console.log("[reminders] deshabilitado (REMINDERS_ENABLED=false)");
    return;
  }
  const ms = config.reminders.intervalMin * 60 * 1000;
  // Primer tick 30s despues del boot (deja que el server se estabilice).
  setTimeout(() => runOnce().catch((e) => console.error("[reminders] runOnce:", e.message)), 30 * 1000);
  setInterval(() => runOnce().catch((e) => console.error("[reminders] runOnce:", e.message)), ms);
  console.log(
    `[reminders] activo — cada ${config.reminders.intervalMin} min, ventana ${config.reminders.windowMin} min, plantilla "${config.reminders.templateName}"`
  );
}

module.exports = { start, runOnce, reminderParams, tipoLabel, horaBogota, clienteDe };
