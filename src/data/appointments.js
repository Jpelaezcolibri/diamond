// Validacion de agenda del asesor: horario laboral + choques de citas.
// Las citas viven en leads.cita (jsonb); a ese objeto se le estampa
// `advisor_id` (uuid del auth.users del asesor) al agendar, para poder
// atribuir cada cita a una agenda. Volumen bajo (decenas/dia): se traen las
// citas de la org y se filtran en JS, sin indice jsonb.
const supabase = require("./supabase");
const memory = require("./memory");

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

module.exports = {
  DEFAULT_HORARIO,
  DURACION_MIN,
  partesBogota,
  dentroDeHorario,
  hayChoque,
  checkAvailability,
};
