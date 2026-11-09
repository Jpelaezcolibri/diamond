// Quien atiende las visitas de un cliente o colega, para uso INTERNO (a quien
// avisar). Con una cita viva es quien la tiene hoy (cita.asesor_id); si no hay
// cita, la asesora principal del radar. Hacia afuera no se nombra a nadie
// (identidad-publica.js; caso Norha, 2026-11-09). Nunca lanza: sin dato, null.
const advisorsData = require("../data/advisors");
const citasData = require("../data/citas");

async function resolverCoordinador({ org, lead, data = advisorsData }) {
  const cita = lead && lead.cita;
  if (cita && cita.asesor_id && citasData.estaViva(cita)) {
    const a = await data.findById(org.id, cita.asesor_id).catch(() => null);
    if (a) return { advisor: a };
  }
  const principal = await data.findAsesorPrincipalRadar(org).catch((e) => {
    console.warn("[engine] No se pudo resolver quien coordina las visitas del colega:", e.message);
    return null;
  });
  return principal ? { advisor: principal } : null;
}

module.exports = { resolverCoordinador };
