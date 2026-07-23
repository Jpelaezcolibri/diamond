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

// Los 4 valores del cuerpo de la plantilla recordatorio_cita, en orden:
// {{1}} asesor, {{2}} tipo, {{3}} cliente, {{4}} hora.
function reminderParams(advisor, lead) {
  return [
    advisor.name || "asesor",
    tipoLabel(lead.cita.tipo),
    lead.nombre || "un cliente",
    horaBogota(lead.cita.fecha_hora),
  ];
}

async function runOnce() {
  if (!config.reminders.enabled) return { sent: 0 };
  const org = await organizations.getDefault();
  if (!org) return { sent: 0 };

  const due = await appointments.dueReminders(org.id, { windowMin: config.reminders.windowMin });
  let sent = 0;
  for (const lead of due) {
    try {
      const advisor = await advisors.findByAuthUserId(org.id, lead.cita.advisor_id);
      if (!advisor || !advisor.phone) continue;
      const wamid = await sendWhatsAppTemplate(org, advisor.phone, {
        name: config.reminders.templateName,
        language: config.reminders.templateLang,
        bodyParams: reminderParams(advisor, lead),
      });
      // Solo marcamos si el envio salio bien: si la plantilla aun no esta
      // aprobada (o falla), se reintenta en el proximo tick.
      if (wamid) {
        await leads.update(lead.id, { cita: { ...lead.cita, recordatorio_enviado: true } });
        sent++;
      }
    } catch (e) {
      console.error("[reminders] error con lead", lead.id, e.message);
    }
  }
  if (sent) console.log(`[reminders] ${sent} recordatorio(s) enviado(s)`);
  return { sent };
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

module.exports = { start, runOnce, reminderParams, tipoLabel, horaBogota };
