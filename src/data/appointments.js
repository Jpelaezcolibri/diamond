// Validacion de agenda del asesor: horario laboral + choques de citas.
// Las citas viven en leads.cita (jsonb); a ese objeto se le estampa
// `advisor_id` (uuid del auth.users del asesor) al agendar, para poder
// atribuir cada cita a una agenda. Volumen bajo (decenas/dia): se traen las
// citas de la org y se filtran en JS, sin indice jsonb.
const supabase = require("./supabase");
const memory = require("./memory");
const citasData = require("./citas");

// Horario por defecto cuando el asesor no configuro el suyo: L-V 8am-6pm.
const DEFAULT_HORARIO = { dias: [1, 2, 3, 4, 5], desde: "08:00", hasta: "18:00" };
// Duracion de una visita para calcular el bloqueo de agenda.
const DURACION_MIN = 60;

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Dia de semana (0=domingo..6=sabado) y minutos-del-dia de un ISO, resueltos
// en hora local de Colombia sin importar el offset con que venga el ISO.
function partesBogota(fechaHoraIso) {
  const d = new Date(fechaHoraIso);
  if (isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const dia = WEEKDAY_INDEX[get("weekday")];
  let hora = parseInt(get("hour"), 10);
  if (hora === 24) hora = 0; // hour12:false puede devolver "24" a medianoche
  const minuto = parseInt(get("minute"), 10);
  return { dia, minutos: hora * 60 + minuto };
}

function hhmmToMin(hhmm) {
  const [h, m] = String(hhmm).split(":").map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}

// La cita debe caer en un dia laboral del asesor y CABER completa (inicio +
// duracion) dentro de su franja horaria. horario null -> DEFAULT_HORARIO.
function dentroDeHorario(horario, fechaHoraIso) {
  const h = horario || DEFAULT_HORARIO;
  const p = partesBogota(fechaHoraIso);
  if (!p) return false;
  const dias = Array.isArray(h.dias) ? h.dias : DEFAULT_HORARIO.dias;
  if (!dias.includes(p.dia)) return false;
  const desde = hhmmToMin(h.desde || DEFAULT_HORARIO.desde);
  const hasta = hhmmToMin(h.hasta || DEFAULT_HORARIO.hasta);
  return p.minutos >= desde && p.minutos + DURACION_MIN <= hasta;
}

// Hay choque si otra cita del MISMO asesor cae a menos de DURACION_MIN de
// distancia. Excluye al propio lead (reagendar no choca consigo mismo).
function hayChoque(leadsConCita, advisorId, fechaHoraIso, excludeLeadId = null) {
  const inicio = new Date(fechaHoraIso).getTime();
  if (isNaN(inicio)) return false;
  const ventanaMs = DURACION_MIN * 60 * 1000;
  return leadsConCita.some((l) => {
    if (l.id === excludeLeadId) return false;
    if (!l.cita || l.cita.advisor_id !== advisorId || !l.cita.fecha_hora) return false;
    // Una cancelada no ocupa espacio (Juan, 2026-09-04): si no se libera la
    // hora, cancelar es cosmetico — el registro cambia y la agenda sigue
    // bloqueada. Una PROPUESTA si ocupa: todavia puede confirmarse y dos
    // personas no pueden reservar la misma hora.
    if (!citasData.estaViva(l.cita)) return false;
    const otra = new Date(l.cita.fecha_hora).getTime();
    if (isNaN(otra)) return false;
    return Math.abs(otra - inicio) < ventanaMs;
  });
}

async function citasDeLaOrg(orgId) {
  if (!supabase) {
    return memory.leads.filter((l) => l.org_id === orgId && l.cita && l.cita.fecha_hora);
  }
  const { data, error } = await supabase
    .from("leads")
    .select("id, cita")
    .eq("org_id", orgId)
    .not("cita", "is", null)
    .limit(500);
  if (error) throw error;
  return (data || []).filter((l) => l.cita && l.cita.fecha_hora);
}

// PROXIMO DISPONIBLE (Juan, 2026-08-21): "todo lo que digan que cuando se
// puede ver inmediatamente se agenda... si el calendario esta todo
// disponible utilizalo y ocupa un espacio". Antes agendar_cita exigia que el
// CLIENTE propusiera dia/hora; esto lo invierte para cuando el cliente solo
// pregunta "¿cuando se puede ver?" sin dar preferencia — el sistema busca el
// primer espacio libre y lo propone, en vez de preguntar y esperar.
//
// Busqueda determinista en codigo, no adivinada por el modelo: hora en punto,
// avanzando de a una hora, reusando exactamente las mismas reglas que ya
// validan una cita puesta a mano (dentroDeHorario + hayChoque) — un espacio
// que este metodo encuentra SIEMPRE pasaria checkAvailability tambien.
const AVISO_MINIMO_MIN = 120; // no ofrecer un espacio a menos de 2h de ahora
const HORIZONTE_DIAS = 21; // si no hay nada libre en 3 semanas, mejor fallar explicito
const HORA_MS = 60 * 60 * 1000;

async function proximoDisponible(orgId, advisor, { desde = new Date() } = {}) {
  const leadsConCita = await citasDeLaOrg(orgId);
  const advisorId = advisor && advisor.auth_user_id;

  const minimo = desde.getTime() + AVISO_MINIMO_MIN * 60 * 1000;
  let ms = Math.ceil(minimo / HORA_MS) * HORA_MS; // proxima hora en punto
  const limite = desde.getTime() + HORIZONTE_DIAS * 24 * HORA_MS;

  while (ms < limite) {
    const iso = new Date(ms).toISOString();
    if (dentroDeHorario(advisor && advisor.horario, iso) && (!advisorId || !hayChoque(leadsConCita, advisorId, iso))) {
      return iso;
    }
    ms += HORA_MS;
  }
  return null;
}

// Valida si un asesor puede atender una cita en fechaHoraIso.
// -> { disponible: true } | { disponible: false, motivo: "fuera_de_horario" | "choque" }
async function checkAvailability(orgId, advisor, fechaHoraIso, { excludeLeadId = null } = {}) {
  if (isNaN(new Date(fechaHoraIso).getTime())) return { disponible: true }; // sin hora fija no bloqueamos
  if (!dentroDeHorario(advisor && advisor.horario, fechaHoraIso)) {
    return { disponible: false, motivo: "fuera_de_horario" };
  }
  // Sin login del CRM no podemos atribuir citas a este asesor: validamos solo
  // horario y dejamos pasar (no peor que el comportamiento anterior).
  const advisorId = advisor && advisor.auth_user_id;
  if (!advisorId) return { disponible: true };

  const leadsConCita = await citasDeLaOrg(orgId);
  if (hayChoque(leadsConCita, advisorId, fechaHoraIso, excludeLeadId)) {
    return { disponible: false, motivo: "choque" };
  }
  return { disponible: true };
}

// ¿A este lead le toca recordatorio ya? Cita con hora + asesor asignado, que
// cae dentro de la proxima ventana (aun no paso), y que no se avisó todavia.
function isReminderDue(lead, nowMs, windowMin) {
  const c = lead && lead.cita;
  if (!c || !c.fecha_hora || !c.advisor_id || c.recordatorio_enviado) return false;
  // Una cancelada no se recuerda (Juan, 2026-09-04). Sin esto, una cita que se
  // cancelo ayer desde el CRM desaparecia del calendario pero al asesor le
  // llegaba igual la plantilla `recordatorio_cita` una hora antes: la agenda
  // que miente, entregada por WhatsApp. Es el incidente que origino la rama.
  // Mismo criterio que hayChoque (linea 68) y que el calendario del CRM.
  if (!citasData.estaViva(c)) return false;
  const t = new Date(c.fecha_hora).getTime();
  if (isNaN(t)) return false;
  return t > nowMs && t <= nowMs + windowMin * 60 * 1000;
}

// Leads con cita proxima que necesitan recordatorio, dentro del alcance de la
// org. Trae las citas de la org y filtra en JS (volumen bajo).
async function dueReminders(orgId, { windowMin = 60, nowMs = null } = {}) {
  const now = nowMs == null ? Date.now() : nowMs;
  if (!supabase) {
    return memory.leads.filter((l) => l.org_id === orgId && isReminderDue(l, now, windowMin));
  }
  const { data, error } = await supabase
    .from("leads")
    .select("id, nombre, phone, property_ref_origen, cita")
    .eq("org_id", orgId)
    .not("cita", "is", null)
    .limit(500);
  if (error) throw error;
  return (data || []).filter((l) => isReminderDue(l, now, windowMin));
}

module.exports = {
  DEFAULT_HORARIO,
  DURACION_MIN,
  partesBogota,
  dentroDeHorario,
  hayChoque,
  checkAvailability,
  proximoDisponible,
  isReminderDue,
  dueReminders,
};
