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
 * @param resultado  { avisada, destinatarioNombre, enCola } — solo aplica si aprobo
 */
function construir(mensaje, veredicto, matches, { avisada = false, destinatarioNombre = null, enCola = false } = {}) {
  if (!veredicto) return null;
  const aprobo = Boolean(veredicto.sirve_alguna);
  const utiles = aprobo
    ? (veredicto.refs_utiles || []).map((ref) => (matches || []).find((m) => String(m.ref) === String(ref))).filter(Boolean)
    : [];

  let estadoAviso = null;
  if (aprobo) {
    // BUG del 2026-09-02: cuando el aviso paso a entregarse agrupado, este
    // feed empezo a decir "NO salio" apenas se encolaba — y salia igual dos
    // minutos despues. Un reporte que dice que se perdio un negocio que en
    // realidad se entrego es peor que no reportar nada: quema la confianza en
    // el resto del panel.
    estadoAviso = avisada
      ? `Aviso enviado${destinatarioNombre ? ` a ${destinatarioNombre}` : ""}.`
      : enCola
        ? "En cola de salida — sale agrupado con lo demas en los proximos minutos."
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

// Version determinista (modo sombra/auto: sin juicio de un modelo — ver la
// nota de diseno en src/groups/vivo.js sobre por que ese camino no usa IA).
// Arma el mismo tipo de mensaje que construir(), pero a partir de lo que ya
// decidieron publicable.js y politica.js, no de un veredicto de Sofi.
//
// Pedido de Juan, 2026-08-19: que los CALLADOS de este camino tambien queden
// en el feed, con el mismo criterio que ya regia para modo asistido — sin
// esto, todo lo que el radar calla en auto/sombra desaparece sin dejar rastro
// para poder hacerles seguimiento.
//
// @param mensaje     { grupo_nombre, autor_nombre, texto_original }
// @param resultado   "publicado" | "sombra" | "callado"
// @param publicables matches que pasaron la compuerta de calidad (puede ser [])
// @param descartados [{ref, motivos}] — lo que NO paso, y por que
// @param decision    lo que devolvio politica.decidir — null si la compuerta
//                     ya dejo 0 publicables (politica ni se llega a correr)
function construirAuto(mensaje, resultado, { publicables = [], descartados = [], decision = null } = {}) {
  const publico = resultado === "publicado" || resultado === "sombra";

  const encabezado = !publico
    ? "❌ El radar CALLO un pedido"
    : resultado === "publicado"
      ? "✅ El radar PUBLICO una respuesta automatica"
      : "🌥️ El radar redacto una respuesta (modo sombra, no se publico)";

  const motivo = publico
    ? null
    : publicables.length === 0
      ? "Ninguna propiedad paso la compuerta de calidad."
      : `Habia candidatas validas, pero la politica de conducta dijo no responder: ${decision?.motivo || "motivo desconocido"}.`;

  const lineasPublicables = publicables.length
    ? `${publico ? "Se ofrecio" : "Habria podido ofrecer"}:\n${publicables.map(linea).join("\n")}`
    : null;

  const lineasDescartadas = descartados.length
    ? `Descartadas por la compuerta de calidad:\n${descartados.map((d) => `▸ Ref ${d.ref || "sin ref"} — ${d.motivos.join(", ")}`).join("\n")}`
    : null;

  return [
    encabezado,
    "",
    `Grupo: ${mensaje.grupo_nombre || "sin nombre"}`,
    `Colega: ${mensaje.autor_nombre || "un colega"}`,
    `Pidio: "${(mensaje.texto_original || "").trim()}"`,
    "",
    motivo,
    lineasPublicables,
    lineasDescartadas,
  ].filter((l) => l !== null).join("\n");
}

async function registrarAuto(org, mensaje, resultado, detalle = {}) {
  const adminUserId = config.groups.feedComando.adminUserId;
  if (!adminUserId) return;

  const texto = construirAuto(mensaje, resultado, detalle);
  if (!texto) return;

  const scope = { orgId: org.id, viewerUid: adminUserId, isAdmin: true };
  const session = await command.ensureSession(scope);
  await command.appendCommandMessage(session.id, "assistant", texto);
}

module.exports = { construir, registrar, construirAuto, registrarAuto };
