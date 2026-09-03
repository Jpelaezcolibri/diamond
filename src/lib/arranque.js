// El informe de arranque: quien es quien, dicho una vez por despliegue.
//
// POR QUE EXISTE (Juan, 2026-09-02, hallazgo #4). Cinco variables de entorno
// deciden a quien le llega que: la revisora del radar, el respaldo, el
// vigilante, las visitas, las copias. Si cualquiera esta vacia en Railway, la
// funcion que depende de ella simplemente no existe — y nadie se entera. El
// respaldo a Catherine estuvo asi quien sabe cuanto: la variable no estaba y
// el aviso se perdia en silencio.
//
// Esto no arregla nada. Dice, al prender, con que configuracion arranco el
// bot, y lo manda al vigilante (el numero de Juan) para que en cinco segundos
// se vea si un despliegue perdio algo. Una sola linea, una sola vez.

const organizations = require("../data/organizations");
const advisors = require("../data/advisors");
// Modulo, no funcion suelta: los tests lo mockean (mismo criterio que el
// vigilante).
const canalWhatsapp = require("../channels/whatsapp");

const enmascarar = (t) => (t ? `***${String(t).replace(/\D/g, "").slice(-4)}` : null);
const listaEnv = (nombre) => (process.env[nombre] || "").split(",").map((t) => t.trim()).filter(Boolean);

// Arma el informe. Devuelve { texto, faltantes } — `faltantes` para que el
// que lo lea no tenga que buscar en la linea que falta.
async function informe(org) {
  const faltantes = [];

  const revisora = await advisors.findAsesorPrincipalRadar(org).catch(() => null);
  if (!revisora) faltantes.push("revisora del radar");

  const equipo = await advisors.listElegibles(org.id, { especialidades: ["venta"] }).catch(() => []);
  const respaldo = equipo.filter((a) => !revisora || a.id !== revisora.id);
  if (!process.env.RADAR_ESCALADO_PHONE && respaldo.length === 0) faltantes.push("respaldo");

  const vigilante = listaEnv("RADAR_WATCHDOG_TO");
  if (vigilante.length === 0) faltantes.push("vigilante (RADAR_WATCHDOG_TO)");

  const visitas = listaEnv("RADAR_VISITAS_ALERTA_TO");
  const copias = listaEnv("RADAR_ALERTA_TO");
  // El link de los avisos (opcion D, 2026-09-03): sin CRM_PUBLIC_URL el aviso
  // sale igual, pero sin link — y sin link no hay "visto" ni "gestionado".
  const linkAvisos = String(process.env.CRM_PUBLIC_URL || "").trim();
  if (!linkAvisos) faltantes.push("link de avisos (CRM_PUBLIC_URL)");

  const partes = [
    `Sofi arranco (${org.name || org.id}).`,
    `Radar: ${organizations.radarEncendido(org) ? "encendido" : "APAGADO"}, respuestas ${organizations.modoDeRespuesta(org)}, compra ${organizations.mandatosActivos(org) ? "encendida" : "apagada"}.`,
    `Revisora: ${revisora ? revisora.name : "NADIE"}.`,
    `Respaldo: ${process.env.RADAR_ESCALADO_PHONE ? enmascarar(process.env.RADAR_ESCALADO_PHONE) : respaldo.map((a) => a.name).join(", ") || "NADIE"}.`,
    `Vigilante: ${vigilante.map(enmascarar).join(", ") || "NADIE"}.`,
    `Visitas: ${visitas.length ? visitas.map(enmascarar).join(", ") : "sin configurar"}.`,
    `Link de avisos: ${linkAvisos || "sin configurar"}.`,
  ];
  // Las copias son la unica que es peor si ESTA: es lo que le mandaba a Juan
  // cada aviso. Solo se menciona cuando hay algo.
  if (copias.length) partes.push(`OJO: cada aviso se copia ademas a ${copias.map(enmascarar).join(", ")} (RADAR_ALERTA_TO).`);
  if (faltantes.length) partes.push(`Sin configurar: ${faltantes.join(", ")}.`);

  return { texto: partes.join(" "), faltantes };
}

// Lo imprime y lo manda al vigilante. Nunca lanza: un informe que revienta no
// puede tumbar el arranque.
async function anunciar() {
  try {
    const org = await organizations.getDefault();
    const { texto } = await informe(org);
    console.log(`[arranque] ${texto}`);
    for (const to of listaEnv("RADAR_WATCHDOG_TO")) {
      const r = await canalWhatsapp.sendWhatsApp(org, to, texto).catch((e) => ({ ok: false, error: e.message }));
      if (!r || !r.ok) console.warn(`[arranque] no se pudo mandar el informe a ${enmascarar(to)}: ${r && r.error}`);
    }
  } catch (e) {
    console.warn("[arranque] no se pudo armar el informe:", e.message);
  }
}

module.exports = { informe, anunciar };
