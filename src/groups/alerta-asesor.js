// El aviso que recibe la asesora cuando Sofi aprueba una oportunidad.
//
// Lo pidio Juan asi: nombre del grupo, quien lo pidio, que busca, y cual de
// nuestras propiedades le sirve. Se agrega el POR QUE de Sofi, que es lo que
// convierte un listado en algo accionable.
//
// TERMINA PIDIENDO UNA RESPUESTA CORTA, y no es cortesia. Cumple dos funciones:
//
//   1. Es el dato que falta para calibrar. El puntaje y el veredicto de Sofi ya
//      quedan guardados; lo que no se puede deducir es si la oportunidad servia
//      de verdad. Solo lo sabe quien llamo al colega.
//   2. Renueva la ventana de 24h. Meta solo entrega texto libre a alguien que
//      escribio en las ultimas 24 horas, y los mensajes que manda Sofi NO
//      extienden ese plazo — solo los de ella. Cada respuesta suya mantiene
//      vivo el canal por el que llegan los avisos siguientes.

const formato = require("../lib/formato");
const { normalizarTitulo } = require("../lib/formato");
const { linkWhatsapp } = require("../lib/contacto");

// Una propiedad, corta: la asesora ya conoce el inventario, no necesita la
// ficha entera. Necesita reconocerla y tener el link a mano.
function linea(match) {
  const titulo = normalizarTitulo(match.titulo) || "Propiedad";
  const datos = [
    match.zona,
    formato.formatearArea(match.area),
    formato.pluralizar(match.habitaciones, "alcoba"),
    formato.formatearPrecio(match.precio),
  ]
    .filter(Boolean)
    .join(" · ");

  // Si a la propiedad le falta un dato, se dice. Es un aviso interno: ocultarlo
  // la haria llamar al colega sin saber que el precio no esta cargado.
  const faltantes = [];
  if (formato.parsearPrecio(match.precio) === null) faltantes.push("sin precio cargado");
  if (!String(match.zona || "").trim()) faltantes.push("sin zona");
  const nota = faltantes.length ? `\n  ⚠️ ${faltantes.join(", ")}` : "";

  return `▸ Ref ${match.ref} — ${titulo}\n  ${datos}${nota}${match.link ? `\n  ${match.link}` : ""}`;
}

/**
 * @param senal      { grupo_nombre, autor_nombre, autor_telefono, texto_original }
 * @param veredicto  lo que devolvio src/groups/revalidar.js
 * @param matches    las candidatas; se muestran solo las que Sofi marco utiles
 * @returns el texto del aviso, o null si no hay nada que decir
 */
function construir(senal, veredicto, matches) {
  if (!veredicto || !Array.isArray(veredicto.refs_utiles) || veredicto.refs_utiles.length === 0) return null;

  const utiles = veredicto.refs_utiles
    .map((ref) => (matches || []).find((m) => String(m.ref) === String(ref)))
    .filter(Boolean);
  if (utiles.length === 0) return null;

  const quien = senal.autor_nombre || "un colega";
  // En vivo el remitente SI trae telefono (a diferencia del export, donde solo
  // llega el nombre) — pero puede venir como @lid (identificador interno de
  // WhatsApp, no marcable): linkWhatsapp() lo filtra en vez de armar un link
  // que no sirve para nada.
  const contactoTexto = linkWhatsapp(senal.autor_telefono) || "sin teléfono — respondele en el grupo";

  return [
    `🎯 Oportunidad en un grupo`,
    ``,
    `Grupo: ${senal.grupo_nombre || "sin nombre"}`,
    `Colega: ${quien}`,
    `Contacto: ${contactoTexto}`,
    ``,
    `Pidió:`,
    `"${(senal.texto_original || "").trim()}"`,
    ``,
    utiles.length === 1 ? `Le puede servir:` : `Le pueden servir:`,
    utiles.map(linea).join("\n"),
    ``,
    `Sofi dice: ${veredicto.por_que}`,
    ``,
    `Contame en qué quedó (la llamaste, no servía, ya se vendió). Con eso el radar aprende.`,
  ].join("\n");
}

module.exports = { construir, linea };
