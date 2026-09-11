// Recordatorio UNICO al asesor si no confirmo una cita PROPUESTA en el plazo.
//
// POR QUE EXISTE (spec 2026-09-10-confirmacion-de-visitas, Juan). Con
// agendar_cita ya no confirmando solo (ver src/agent/tools.js), una cita
// PROPUESTA puede quedar asi para siempre si el asesor no ve el aviso o se le
// pasa por alto -- y el cliente nunca se entera de que nadie la reviso.
// Mismo patron que src/scheduler/radar-recordatorio.js: temporizador
// in-process, un solo empujon por cita en toda su vida (recordatorio_
// confirmacion_enviado, dentro de leads.cita).
//
// RESOLUCION DE LA ORG (revision de esta tarea): mensajeAsesor.enviarYRegistrar
// pasa la org tal cual a canalWhatsapp.sendWhatsApp, que via credsFor lee
// org.whatsapp_token y org.whatsapp_phone_id -- y solo cae al fallback de
// config.whatsapp.phoneId cuando org.whatsapp_phone_id es EXACTAMENTE
// "DEMO_PHONE_ID" ausente de otra forma (ver src/channels/whatsapp.js#credsFor).
// Un objeto sintetico { id: lead.org_id } deja whatsapp_phone_id en `undefined`,
// que no dispara ese fallback (`undefined !== "DEMO_PHONE_ID"` es true) y el
// envio queda sin phoneId aunque config.whatsapp.phoneId si exista. Por eso
// aca se resuelve la org REAL con organizations.findById antes de mandar nada;
// si no se puede resolver, se salta ese lead en este tick (no se marca como
// recordado, para poder reintentar en el siguiente).
const config = require("../config");
const organizations = require("../data/organizations");
const advisors = require("../data/advisors");
const leads = require("../data/leads");
const mensajeAsesor = require("../lib/mensaje-asesor");
const { formatCitaFechaHora } = require("../notifications/advisor");

function textoRecordatorio(lead, advisor) {
  const fh = formatCitaFechaHora(lead.cita.fecha_hora);
  const cuando = fh ? `${fh.fecha} a las ${fh.hora}` : lead.cita.descripcion || "sin fecha";
  const saludo = advisor && advisor.name ? advisor.name.split(/\s+/)[0] : null;
  const quien = lead.nombre || `+${lead.phone}`;
  const cuerpo = `tenes una cita PROPUESTA con ${quien} para ${cuando} que todavia no confirmaste.`;
  return [
    saludo ? `${saludo}, ${cuerpo}` : cuerpo.charAt(0).toUpperCase() + cuerpo.slice(1),
    `Respondé *OK CONFIRMADA* para confirmarla, o contame otra hora si hay que moverla.`,
  ].join("\n\n");
}

async function runOnce() {
  if (!config.citasRecordatorio.enabled) return { sent: 0 };

  let vencidas;
  try {
    vencidas = await leads.listConCitasPropuestasVencidas(config.citasRecordatorio.silenceMin);
  } catch (e) {
    console.error("[citas-recordatorio] error leyendo citas vencidas:", e.message);
    return { sent: 0 };
  }

  // Cache por org dentro de esta corrida: varios leads vencidos de la misma
  // organizacion no deberian disparar una consulta de organizations por cada
  // uno (mismo criterio que radar-recordatorio.js, que resuelve la org una
  // vez por iteracion en vez de por señal).
  const orgsCache = new Map();
  async function resolverOrg(orgId) {
    if (orgsCache.has(orgId)) return orgsCache.get(orgId);
    const org = await organizations.findById(orgId).catch(() => null);
    orgsCache.set(orgId, org);
    return org;
  }

  let sent = 0;
  for (const lead of vencidas) {
    try {
      const org = await resolverOrg(lead.org_id);
      if (!org) {
        console.warn(`[citas-recordatorio] No se pudo resolver la organizacion ${lead.org_id} — se salta el lead ${lead.id} en este tick.`);
        continue;
      }

      const advisor = await advisors.findByAuthUserId(lead.org_id, lead.cita.advisor_id).catch(() => null);
      if (!advisor || !advisor.phone) continue;

      const { ok } = await mensajeAsesor.enviarYRegistrar(
        org,
        advisor.phone,
        textoRecordatorio(lead, advisor)
      );
      // Se marca SIEMPRE, salga o no: si la ventana esta cerrada, reintentar
      // en el proximo tick no la va a abrir (mismo criterio que
      // radar-recordatorio.js) -- lo unico que la reabre es que el asesor le
      // escriba primero a Sofi, y eso no depende de este scheduler.
      await leads.update(lead.id, { cita: { ...lead.cita, recordatorio_confirmacion_enviado: true } });
      if (ok) sent++;
      else console.warn(`[citas-recordatorio] No se pudo avisar a ${advisor.name} de la cita con ${lead.nombre || lead.phone}`);
    } catch (e) {
      console.error("[citas-recordatorio] error con lead", lead.id, e.message);
    }
  }
  if (sent) console.log(`[citas-recordatorio] ${sent} recordatorio(s) enviado(s)`);
  return { sent };
}

let timer = null;
function start() {
  if (!config.citasRecordatorio.enabled) {
    console.log("[citas-recordatorio] deshabilitado (CITAS_RECORDATORIO_ENABLED=false)");
    return null;
  }
  const ms = config.citasRecordatorio.intervalMin * 60 * 1000;
  setTimeout(() => runOnce().catch((e) => console.error("[citas-recordatorio] runOnce:", e.message)), 45 * 1000);
  timer = setInterval(() => runOnce().catch((e) => console.error("[citas-recordatorio] runOnce:", e.message)), ms);
  console.log(
    `[citas-recordatorio] activo — cada ${config.citasRecordatorio.intervalMin} min, silencio ${config.citasRecordatorio.silenceMin} min`
  );
  return timer;
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, runOnce, textoRecordatorio };
