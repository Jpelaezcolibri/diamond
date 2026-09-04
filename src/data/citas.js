// El estado de una cita, y quien puede moverlo.
//
// POR QUE EXISTE (Juan, 2026-09-04). `leads.cita` es un jsonb que se escribia
// UNA sola vez con estado "solicitada" (src/agent/tools.js#agendar_cita) y que
// nadie volvia a tocar: no habia forma de cancelar ni de reprogramar. El
// calendario del equipo (crm/lib/calendar-events.ts) ni siquiera tenia el
// campo en su tipo, asi que una cita cancelada se seguia mostrando.
//
// El caso que lo destapo: el 2026-09-04 un colega pidio una visita para las
// 16:00 del mismo dia, se cancelo, y el registro siguio diciendo "solicitada".
//
// RETROCOMPATIBILIDAD, y es lo que evita una migracion: una cita sin `estado`
// —todas las que ya existen— se lee como `confirmada`. Es lo que el equipo
// asumio todo este tiempo; inventarle otro estado seria reescribir la
// historia. Por eso `estadoDe` nunca falla ni devuelve null.
const ESTADOS = ["propuesta", "confirmada", "cancelada", "reprogramada"];

function esValido(estado) {
  return ESTADOS.includes(estado);
}

function estadoDe(cita) {
  const e = cita && cita.estado;
  return esValido(e) ? e : "confirmada";
}

// Lo que consultan el calendario y el anti-choque de la agenda. Una cancelada
// no ocupa espacio ni se muestra; una propuesta SI ocupa —todavia puede
// confirmarse, y dos personas no pueden reservar la misma hora.
function estaViva(cita) {
  if (!cita) return false;
  return estadoDe(cita) !== "cancelada";
}

module.exports = { ESTADOS, esValido, estadoDe, estaViva };
