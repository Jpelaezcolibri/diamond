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
//
// CONTACTO DEL COLEGA (Juan, 2026-08-22): "que se notifique al celular de
// natalia todo para que ella lo responda directamente desde su numero" — el
// gremio pide no llenar los grupos de informacion, asi que este aviso YA NO
// puede decir "respondele en el grupo". `senal.autor_telefono` que llega de
// WhatsApp CASI SIEMPRE es un @lid (14-17 digitos), no un telefono real
// (medido en produccion el 2026-08-22: 12 de 12 eran LID) — por eso
// `construir` recibe aparte el telefono YA RESUELTO por
// src/groups/directorio.js (67% de resolucion medido ese mismo dia), que es
// el camino principal. Con telefono resuelto: link directo al privado.
//
// autor_telefono se usa igual, pero solo como ULTIMO intento (revision
// 2026-08-24): WhatsApp a veces entrega el participante como @c.us —numero
// visible, no LID— y ese numero SI es marcable de una. Descartarlo de
// entrada porque "normalmente" es un LID dejaba el aviso diciendo "no se
// pudo resolver el numero" con el numero ahi mismo en la señal. linkWhatsapp
// filtra con esMarcable, asi que un LID de verdad sigue sin mostrarse.
//
// Sin ninguno de los dos (el 33% esperado, no un error): la salida real es
// tocar el nombre del colega en el grupo, que WhatsApp abre el chat sin pedir
// el numero.

const formato = require("../lib/formato");
const { normalizarTitulo } = require("../lib/formato");
const { linkWhatsapp, linkContactoOficial, tocarNombreEnGrupo } = require("../lib/contacto");

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

// Texto de contacto: con telefono resuelto, el link directo al privado; sin
// el, la instruccion real para ese 33% — nunca "respondele en el grupo"
// (norma de Juan, 2026-08-22), porque el gremio pide no llenar los grupos de
// informacion y esa frase invitaba justo a eso. tocarNombreEnGrupo vive en
// src/lib/contacto.js (2026-08-24): esta misma instruccion se necesito en
// otros avisos, ver la nota ahi.
//
// autorTelefono (revision 2026-08-24): ultimo intento antes de rendirse.
// `telefonoColega` es el numero YA RESUELTO por src/groups/directorio.js
// (67% de resolucion medido el 2026-08-22) y cubre el caso normal. Pero
// cuando WhatsApp entrega el participante como @c.us — numero visible, no
// LID — este aviso decia "no se pudo resolver el numero" TENIENDO el numero
// a mano en senal.autor_telefono. linkWhatsapp ya valida con esMarcable, asi
// que si autorTelefono resulta ser un LID (14-17 digitos) esto sigue
// devolviendo null y cae al mismo mensaje de siempre — no hay riesgo de
// mostrar un LID como si fuera un telefono.
function contactoPara(telefonoColega, autorTelefono, quien) {
  const link = linkWhatsapp(telefonoColega) || linkWhatsapp(autorTelefono);
  if (link) return link;
  return `no se pudo resolver el número — ${tocarNombreEnGrupo(quien)}`;
}

/**
 * @param senal           { grupo_nombre, autor_nombre, autor_telefono, texto_original }
 * @param veredicto       lo que devolvio src/groups/revalidar.js
 * @param matches         las candidatas; se muestran solo las que Sofi marco utiles
 * @param telefonoColega  telefono YA RESUELTO del colega (src/groups/directorio.js#telefonoDe),
 *                        o null/undefined si no se pudo resolver. Parametro nuevo y opcional:
 *                        quien llame a `construir` sin el sigue funcionando, solo que sin link
 *                        directo al privado.
 * @returns el texto del aviso, o null si no hay nada que decir
 */
function construir(senal, veredicto, matches, telefonoColega = null) {
  if (!veredicto || !Array.isArray(veredicto.refs_utiles) || veredicto.refs_utiles.length === 0) return null;

  const utiles = veredicto.refs_utiles
    .map((ref) => (matches || []).find((m) => String(m.ref) === String(ref)))
    .filter(Boolean);
  if (utiles.length === 0) return null;

  const quien = senal.autor_nombre || "un colega";
  const contactoTexto = contactoPara(telefonoColega, senal.autor_telefono, quien);

  const lineas = [
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
  ];

  // Renglon listo para copiar hacia la linea OFICIAL de Sofi (Juan,
  // 2026-08-22) — solo si CONTACT_WHATSAPP_NUMBER esta definida. Nunca a
  // medias: ver la nota en src/lib/contacto.js#linkContactoOficial.
  const linkSofi = linkContactoOficial();
  if (linkSofi) {
    lineas.push(
      ``,
      `Para que la conversación quede en nuestro sistema, cerrale invitándolo a escribirle a Sofi (nuestra línea oficial):`,
      linkSofi
    );
  }

  lineas.push(
    ``,
    `Contame en qué quedó (la llamaste, no servía, ya se vendió). Con eso el radar aprende.`
  );

  return lineas.join("\n");
}

module.exports = { construir, linea };
