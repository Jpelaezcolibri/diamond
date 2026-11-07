// Quien "coordina las visitas" ante el colega (bloque COORDINA LAS VISITAS del
// prompt). Caso Nancy (2026-11-06): Sofi le dijo "Asesor 1 te la confirma"
// cuando la cita estaba rotando en Asesor 3. Con una cita viva, es quien la
// tiene hoy (cita.asesor_id); si no hay cita, la asesora principal del radar.
// Hacia afuera solo va el alias (identidad-publica.js). Nunca lanza: sin dato,
// null, y el prompt le dice a Sofi que no invente a nadie.
const advisorsData = require("../data/advisors");
const citasData = require("../data/citas");
const { aliasPublico } = require("./identidad-publica");

async function resolverCoordinador({ org, lead, data = advisorsData }) {
  const cita = lead && lead.cita;
  if (cita && cita.asesor_id && citasData.estaViva(cita)) {
    const a = await data.findById(org.id, cita.asesor_id).catch(() => null);
    const alias = a ? aliasPublico(a, org) : null;
    if (alias) return { alias };
  }
  const principal = await data.findAsesorPrincipalRadar(org).catch((e) => {
    console.warn("[engine] No se pudo resolver quien coordina las visitas del colega:", e.message);
    return null;
  });
  const alias = principal ? aliasPublico(principal, org) : null;
  return alias ? { alias } : null;
}

module.exports = { resolverCoordinador };
