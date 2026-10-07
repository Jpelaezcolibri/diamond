// Rotacion de citas por confirmar (Juan, 2026-10-07; spec §4.2-4.3): las
// citas van a los asesores con recibe_citas, en orden (Asesor 1, 2, 3), y si
// uno no confirma en una hora pasa al siguiente. La cita se ata al asesor por
// advisors.id (cita.asesor_id): Claudia no tiene usuario del CRM, asi que el
// auth_user_id (cita.advisor_id) no alcanza. Las citas viejas solo tienen el
// auth; ocupadasDe reconoce las dos.
const supabase = require("./supabase");
const memory = require("./memory");
const citasData = require("./citas");
const { validarHora } = require("../lib/agenda-reglas");

async function asesoresDelCiclo(orgId) {
  if (!supabase) {
    return memory.advisors
      .filter((a) => a.org_id === orgId && a.activo && a.recibe_citas)
      .sort((a, b) => (a.orden_citas || 99) - (b.orden_citas || 99));
  }
  const { data, error } = await supabase
    .from("advisors")
    .select("*")
    .eq("org_id", orgId)
    .eq("activo", true)
    .eq("recibe_citas", true)
    .order("orden_citas", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data || [];
}

function esDe(cita, advisor) {
  if (!cita || !advisor) return false;
  if (cita.asesor_id) return cita.asesor_id === advisor.id;
  return Boolean(advisor.auth_user_id) && cita.advisor_id === advisor.auth_user_id;
}

function ocupadasDe(citasOrg, advisor, { excluirLeadId = null } = {}) {
  return (citasOrg || [])
    .filter((l) => l.id !== excluirLeadId && l.cita && l.cita.fecha_hora && citasData.estaViva(l.cita) && esDe(l.cita, advisor))
    .map((l) => l.cita.fecha_hora);
}

function libre(advisor, { citasOrg, fechaHoraIso, ahora, excluirLeadId }) {
  return validarHora({ fechaHoraIso, ahora, horario: advisor.horario, ocupadas: ocupadasDe(citasOrg, advisor, { excluirLeadId }) }).ok;
}

// Entre los que tienen la hora libre, el de menos citas vivas a futuro; empate
// por orden. null si nadie puede (anticipacion, horario o choque en todos).
function elegirAsesor({ ciclo, citasOrg, fechaHoraIso, ahora = new Date(), excluirLeadId = null }) {
  const futuras = (a) =>
    ocupadasDe(citasOrg, a, { excluirLeadId }).filter((f) => new Date(f).getTime() > ahora.getTime()).length;
  const candidatos = (ciclo || []).filter((a) => libre(a, { citasOrg, fechaHoraIso, ahora, excluirLeadId }));
  if (candidatos.length === 0) return null;
  return candidatos.slice().sort((a, b) => futuras(a) - futuras(b) || (a.orden_citas || 99) - (b.orden_citas || 99))[0];
}

// El proximo en orden circular despues del actual que tenga la hora libre. Si
// nadie mas la tiene libre, se queda el actual. `ahora` lo pasa la escalera
// como el creada_at de la cita: la anticipacion se midio al crearla, y horas
// despues la visita ya puede estar a menos de 24 h.
function siguiente({ ciclo, actualId, citasOrg, fechaHoraIso, ahora = new Date(), excluirLeadId = null }) {
  const lista = ciclo || [];
  if (lista.length === 0) return null;
  const i = lista.findIndex((a) => a.id === actualId);
  for (let paso = 1; paso <= lista.length; paso++) {
    const a = lista[(Math.max(i, 0) + paso) % lista.length];
    if (a.id === actualId) return a;
    if (libre(a, { citasOrg, fechaHoraIso, ahora, excluirLeadId })) return a;
  }
  return lista.find((a) => a.id === actualId) || null;
}

module.exports = { asesoresDelCiclo, ocupadasDe, elegirAsesor, siguiente, esDe };
