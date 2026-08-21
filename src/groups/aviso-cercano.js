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

// EDIFICIO ESPECIFICO (Juan, 2026-08-21 — caso Esteban Higuita, pidiendo por
// el "*edificio Murano Plaza*" en Envigado): "el asesor sabe donde quedan las
// propiedades pero en wasi no las tenemos marcadas por edificio por
// seguridad... se debe pasar de una a natalia sin responder nada". Distinto
// del aviso normal en dos formas:
//   1. Se manda AUNQUE no haya candidatas por zona (vivo.js#avisarCercano) —
//      Natalia puede conocer algo en ese edificio que el cruce por zona nunca
//      iba a encontrar.
//   2. Nunca lleva los botones Sí/No: publicar una candidata de zona como si
//      fuera el edificio pedido es exactamente el dato no verificable que
//      esta señal existe para frenar. La accion correcta es que ELLA
//      responda con lo que sabe, no que apruebe un match a ciegas.
/**
 * @param señal      { grupo_nombre, autor_nombre, texto_original }
 * @param candidatas matches con dato usable en la misma zona (puede ser [])
 * @param edificio   nombre del edificio/torre/conjunto que el pedido nombró
 * @returns el texto del aviso, o null si falta el nombre del edificio
 */
function construirEdificio(señal, candidatas, edificio) {
  if (!edificio) return null;
  const lista = Array.isArray(candidatas) ? candidatas : [];

  return [
    `🏢 Piden el edificio "${edificio}" — esto lo tenés que revisar vos`,
    ``,
    `Grupo: ${señal.grupo_nombre || "sin nombre"}`,
    `Colega: ${señal.autor_nombre || "un colega"}`,
    ``,
    `Pidió:`,
    `"${(señal.texto_original || "").trim()}"`,
    ``,
    `Wasi no tiene las propiedades marcadas por edificio (por seguridad), así que el sistema no puede confirmar si algo del inventario es exactamente ese lugar — por eso no le respondió solo.`,
    ``,
    lista.length
      ? [
          `Esto es lo que encontró por zona (puede o no ser ese edificio, confirmalo vos):`,
          lista.map(ficha).join("\n"),
        ].join("\n")
      : `Por zona tampoco encontró nada. Si conocés algo en ese edificio, respondele directo en el grupo.`,
  ].join("\n");
}

module.exports = { construir, construirEdificio, ficha };
