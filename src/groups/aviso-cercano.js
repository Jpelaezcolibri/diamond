// El aviso que recibe quien revisa lo que el radar NO respondió solo — sea
// cual sea la razón (puntaje, zona, config del grupo, fuente aliado). Ya no
// se cura por motivo (vivo.js#avisarCercano): si el motor encontró alguna
// candidata con dato usable, se avisa. El juicio de si sirve lo pone la
// persona, no el motivo.
//
// Juan, 2026-08-20: "necesito que catherine uribe reciba que se envió y que
// no y por que no para que ella apruebe desde su celular" → después
// corregido a que sea el celular de Natalia Vélez, la misma línea vinculada
// al radar, "para no perder la trazabilidad" — si ella aprueba, se publica
// por la MISMA vía auditada (vivo.js#aprobarManual), no por una identidad
// distinta. Ampliado el mismo día, dos veces: "tenemos que crear una norma
// que no se salte ninguno de los dos" (ni el camino automático ni el humano
// pueden dejar pasar un match real) y despues "lo que no se responda por el
// bot debe de ir de una al chat de natalia... explica en el mensaje que
// debe responder si o no para que se reenvie, asi no vamos a tener
// diferencias" — de ahi el cierre explícito pidiendo sí O no (antes solo
// pedía el sí, y un "no" se perdía sin quedar registrado en ningún lado; ver
// src/agent/tools.js#rechazarPedidoRadar).
//
// Distinto de alerta-asesor.js (que depende del veredicto de Sofi en modo
// asistido, hoy apagado): acá no hay juicio de IA, solo el dato crudo del
// motor — el juicio lo pone la persona.

const formato = require("../lib/formato");

function ficha(match) {
  const titulo = formato.normalizarTitulo(match.titulo) || `Ref ${match.ref || "sin ref"}`;
  const datos = [match.zona, formato.formatearPrecio(match.precio)].filter(Boolean).join(" · ");
  return `▸ Ref ${match.ref} — ${titulo} (${match.puntaje}%)${datos ? `\n  ${datos}` : ""}`;
}

/**
 * @param señal      { grupo_nombre, autor_nombre, texto_original }
 * @param candidatas matches con dato usable que el bot no respondio solo
 * @returns el texto del aviso, o null si no hay nada que decir
 */
// BOTONES (Juan, 2026-08-21): "se esta enredando con las respuestas y
// estamos perdiendo es plata" — pedirle "sí"/"no" en texto libre obligaba a
// Sofi a interpretar la respuesta en medio de otra conversacion, y con mas
// de un pedido pendiente a la vez ni una persona sabe a cual se refiere un
// "sí" suelto. El mensaje ya NO pide una respuesta escrita — src/groups/vivo.js
// lo manda con dos botones (Sí, publicar / No sirve) que traen el id de la
// señal adentro, asi que la accion se resuelve sola, sin ambigüedad. Ver
// src/channels/whatsapp.js#sendWhatsAppButtons.
function construir(señal, candidatas) {
  if (!Array.isArray(candidatas) || candidatas.length === 0) return null;

  return [
    `🔔 Tenés un match del radar que no salió solo — ¿lo publicamos?`,
    ``,
    `Grupo: ${señal.grupo_nombre || "sin nombre"}`,
    `Colega: ${señal.autor_nombre || "un colega"}`,
    ``,
    `Pidió:`,
    `"${(señal.texto_original || "").trim()}"`,
    ``,
    `Lo que tenemos:`,
    candidatas.map(ficha).join("\n"),
  ].join("\n");
}

module.exports = { construir, ficha };
