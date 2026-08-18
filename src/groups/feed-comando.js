// Feed en vivo, para el admin: cada vez que Sofi revisa un pedido del radar
// —lo apruebe o lo rechace— esto le deja un mensaje en su propia sesion de
// Sofi-Comando, sin que tenga que preguntar (trazabilidad_radar sigue
// sirviendo para consultar el historico; esto es lo que pasa AHORA).
//
// Pedido de Juan, 2026-08-18: "los aprobados van para Catherine [sin cambios
// ahi] y los aprobados Y rechazados quedan en el panel de super admin".
//
// Deliberadamente separado del aviso a la asesora (alerta-asesor.js): ese
// mensaje es para ELLA, corto y accionable. Este es para AUDITAR el motor,
// asi que lleva el veredicto completo — incluido el "por que" cuando Sofi
// rechaza, que es el dato que mas sirve para calibrar.

const formato = require("../lib/formato");
const config = require("../config");
const command = require("../data/command");

function linea(m) {
  const titulo = formato.normalizarTitulo(m.titulo) || `Ref ${m.ref || "sin ref"}`;
  const datos = [m.zona, formato.formatearPrecio(m.precio)].filter(Boolean).join(" · ");
  return `▸ ${titulo}${datos ? ` — ${datos}` : ""}`;
}

/**
 * @param mensaje    { grupo_nombre, autor_nombre, texto_original }
 * @param veredicto  lo que devolvio src/groups/revalidar.js
 * @param matches    las candidatas que vio Sofi
 * @param resultado  { avisada, destinatarioNombre } — solo aplica si aprobo
 */
function construir(mensaje, veredicto, matches, { avisada = false, destinatarioNombre = null } = {}) {
  if (!veredicto) return null;
  const aprobo = Boolean(veredicto.sirve_alguna);
  const utiles = aprobo
    ? (veredicto.refs_utiles || []).map((ref) => (matches || []).find((m) => String(m.ref) === String(ref))).filter(Boolean)
    : [];

  let estadoAviso = null;
  if (aprobo) {
    estadoAviso = avisada
      ? `Aviso enviado${destinatarioNombre ? ` a ${destinatarioNombre}` : ""}.`
      : "Aprobo, pero el aviso NO salio (ventana de 24h cerrada o sin destinatario — ver trazabilidad_radar).";
  }

  return [
    aprobo ? "✅ Sofi APROBO un pedido del radar" : "❌ Sofi DESCARTO un pedido del radar",
    "",
    `Grupo: ${mensaje.grupo_nombre || "sin nombre"}`,
    `Colega: ${mensaje.autor_nombre || "un colega"}`,
    `Pidio: "${(mensaje.texto_original || "").trim()}"`,
    "",
    utiles.length ? `Le sirve:\n${utiles.map(linea).join("\n")}` : null,
    `Sofi dice: ${veredicto.por_que || "sin explicacion"}`,
    veredicto.desacuerdo_con_puntaje ? `Desacuerdo con el puntaje del motor: ${veredicto.desacuerdo_con_puntaje}` : null,
    estadoAviso,
  ].filter((l) => l !== null).join("\n");
}

// A que sesion escribir. Configurable (RADAR_FEED_COMANDO_ADMIN_ID = el auth
// user id del admin, no su email) para no hardcodear a una persona en el
// codigo — sin configurar, el feed simplemente no escribe en ningun lado.
async function registrar(org, mensaje, veredicto, matches, resultado = {}) {
  const adminUserId = config.groups.feedComando.adminUserId;
  if (!adminUserId) return;

  const texto = construir(mensaje, veredicto, matches, resultado);
  if (!texto) return;

  const scope = { orgId: org.id, viewerUid: adminUserId, isAdmin: true };
  const session = await command.ensureSession(scope);
  await command.appendCommandMessage(session.id, "assistant", texto);
}

module.exports = { construir, registrar };
