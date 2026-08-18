// Ultima linea de defensa antes de mandar un mensaje que Sofi redacto sola.
//
// POR QUE EXISTE. El prompt de Sofi-Comando ya le prohibe inventar un link de
// contacto cuando no lo tiene (ver RADAR DE GRUPOS en sofi-comando-prompts.js)
// — pero un prompt es una instruccion, no una garantia. Caso real 2026-08-18:
// Sofi le mando a Catherine un mensaje con "https://wa.me/message/YOUR_CONTACT_LINK",
// un placeholder inventado, en vez de decir "sin telefono" como se le pidio.
//
// Esto no reemplaza el prompt — lo complementa con una compuerta de codigo
// que no depende de que el modelo se acuerde de la regla en cada turno.

// Cosas que un texto redactado por un LLM no deberia contener nunca: marcas
// de "esto lo tenes que rellenar vos" que dejo a medio camino.
const MARCADORES_SIN_RELLENAR = [
  /\bYOUR_[A-Z_]+\b/,
  /\bPLACEHOLDER\b/i,
  /\[(link|tel[eé]fono|contacto|numero|n[uú]mero)[^\]]*\]/i,
  /\bXXXX+\b/,
  /<[a-z_]+>/i,
];

function tieneMarcadorSinRellenar(texto) {
  return MARCADORES_SIN_RELLENAR.some((patron) => patron.test(texto));
}

// Un link de wa.me real termina en puros digitos (el numero, 10-15 segun el
// pais). Cualquier otra cosa ahi —una palabra, un placeholder— es un link que
// no lleva a ningun lado.
function linksWaInvalidos(texto) {
  const matches = [...String(texto || "").matchAll(/wa\.me\/([^\s)]+)/gi)];
  return matches.map((m) => m[1]).filter((valor) => !/^\d{10,15}$/.test(valor));
}

// Devuelve null si el texto esta limpio, o un motivo corto si hay que
// bloquear el envio.
function motivoDeBloqueo(texto) {
  if (tieneMarcadorSinRellenar(texto)) return "el mensaje tiene un marcador sin rellenar (tipo YOUR_..., PLACEHOLDER, [link])";
  const rotos = linksWaInvalidos(texto);
  if (rotos.length > 0) return `el mensaje tiene un link de WhatsApp que no es real (wa.me/${rotos[0]})`;
  return null;
}

module.exports = { motivoDeBloqueo, tieneMarcadorSinRellenar, linksWaInvalidos };
