// El aviso que recibe quien revisa lo que el radar NO respondió solo — sea
// cual sea la razón (puntaje, zona, config del grupo, fuente aliado). Ya no
// se cura por motivo (vivo.js#avisarCercano): si el motor encontró alguna
// candidata con dato usable, se avisa. El juicio de si sirve lo pone la
// persona, no el motivo.
//
// Juan, 2026-08-20: "necesito que catherine uribe reciba que se envió y que
// no y por que no para que ella apruebe desde su celular" → después
// corregido a que sea el celular de Natalia Vélez, la misma línea vinculada
// al radar, "para no perder la trazabilidad". Ampliado el mismo día, dos
// veces: "tenemos que crear una norma que no se salte ninguno de los dos"
// (ni el camino automático ni el humano pueden dejar pasar un match real) y
// despues "lo que no se responda por el bot debe de ir de una al chat de
// natalia... explica en el mensaje que debe responder si o no para que se
// reenvie, asi no vamos a tener diferencias" — de ahi el cierre explícito
// pidiendo sí O no (antes solo pedía el sí, y un "no" se perdía sin quedar
// registrado en ningún lado; ver src/agent/tools.js#rechazarPedidoRadar).
//
// CAMBIO DE POLITICA (Juan, 2026-08-22): "que se notifique al celular de
// natalia todo para que ella lo responda directamente desde su numero" — el
// gremio pide no llenar los grupos de informacion, asi que el radar YA NO
// publica nada ahi, ni con aprobacion. El aviso dejo de preguntar "¿lo
// publicamos?" (eso es justo lo que Natalia toco dos veces el mismo dia — el
// mensaje seguia ofreciendo la accion vieja aunque la norma ya habia
// cambiado) y ahora pide que ELLA le responda al colega por privado, con las
// refs listas para copiar. El boton "Sí, publicar" se quito en
// vivo.js#avisarCercano por el mismo motivo; aprobarManual (vivo.js) sigue
// existiendo para publicar a proposito desde el CRM, pero ya no se ofrece
// como un toque en este aviso.
//
// Distinto de alerta-asesor.js (que depende del veredicto de Sofi en modo
// asistido, hoy apagado): acá no hay juicio de IA, solo el dato crudo del
// motor — el juicio lo pone la persona.

const formato = require("../lib/formato");
const { linkContactoOficial, tocarNombreEnGrupo } = require("../lib/contacto");

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
// SIN "¿LO PUBLICAMOS?" (Juan, 2026-08-22): la norma del gremio es no llenar
// los grupos de informacion — el radar ya no publica nada ahi, ni con
// aprobacion. Antes este aviso ofrecia justo esa accion (antes con texto
// libre, despues con el boton "Sí, publicar" en vivo.js#avisarCercano) y
// Natalia lo toco dos veces el mismo dia porque nadie le avisó del cambio de
// norma y el mensaje seguia preguntando. Ahora el aviso pide la UNICA accion
// que sigue viva: que ELLA le responda al colega por privado, con el dato ya
// listo para copiar — la publicacion en el grupo dejo de ofrecerse como un
// toque (aprobarManual en vivo.js sigue existiendo para publicar a proposito
// desde el CRM, no desde este aviso).
function construir(señal, candidatas) {
  if (!Array.isArray(candidatas) || candidatas.length === 0) return null;

  const quien = señal.autor_nombre || "el colega";

  const lineas = [
    `🔔 Un pedido del radar no salió solo — te toca responder vos`,
    ``,
    `Grupo: ${señal.grupo_nombre || "sin nombre"}`,
    `Colega: ${quien}`,
    ``,
    `Pidió:`,
    `"${(señal.texto_original || "").trim()}"`,
    ``,
    `Respondele por privado a ${quien}, no en el grupo: desde tu WhatsApp (el que está metido en ese grupo), ${tocarNombreEnGrupo(quien)}.`,
    ``,
    `Lo que tenemos, listo para copiar:`,
    candidatas.map(ficha).join("\n"),
  ];

  const link = linkContactoOficial();
  if (link) {
    lineas.push(
      ``,
      `Para que la conversación quede en nuestro sistema, cerrale invitándolo a escribirle a Sofi (nuestra línea oficial):`,
      link
    );
  }

  lineas.push(
    ``,
    `Contame en qué quedó (le escribiste, no le sirvió, hubo negocio). Con eso el radar aprende.`
  );

  return lineas.join("\n");
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
  const quien = señal.autor_nombre || "el colega";

  // Antes la rama sin candidatas decia "respondele directo en el grupo" — eso
  // era la misma accion vieja que la norma del 2026-08-22 vino a sacar (ver la
  // cabecera del archivo). Ahora las dos ramas (con y sin candidatas por
  // zona) terminan igual: si Natalia sabe algo, se lo dice al colega por
  // privado, nunca publicando en el grupo.
  const cuerpo = lista.length
    ? [
        `Esto es lo que encontró por zona (puede o no ser ese edificio, confirmalo vos):`,
        lista.map(ficha).join("\n"),
      ].join("\n")
    : `Por zona tampoco encontró nada.`;

  return [
    `🏢 Piden el edificio "${edificio}" — esto lo tenés que revisar vos`,
    ``,
    `Grupo: ${señal.grupo_nombre || "sin nombre"}`,
    `Colega: ${quien}`,
    ``,
    `Pidió:`,
    `"${(señal.texto_original || "").trim()}"`,
    ``,
    `Wasi no tiene las propiedades marcadas por edificio (por seguridad), así que el sistema no puede confirmar si algo del inventario es exactamente ese lugar — por eso no le respondió solo.`,
    ``,
    cuerpo,
    ``,
    `Si conocés algo en ese edificio, respondele por privado a ${quien} (no en el grupo): ${tocarNombreEnGrupo(quien)}.`,
  ].join("\n");
}

module.exports = { construir, construirEdificio, ficha };
