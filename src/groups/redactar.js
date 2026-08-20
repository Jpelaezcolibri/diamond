// Redacta el mensaje que Sofi publica dentro del grupo gremial.
//
// Vive en el servidor, no en el CRM: el borrador de crm/components/senales-grupos.tsx
// se escribio para que un humano lo copiara y lo corrigiera de paso. Aca no hay
// humano corrigiendo, asi que cada campo pasa por src/lib/formato.js y ninguna
// propiedad llega sin pasar por src/groups/publicable.js.
//
// Decisiones de contenido, todas con motivo:
//   · Maximo 3 propiedades. Seis bloques de cuatro lineas son un muro en un
//     grupo activo, y el cuarto match ya suele ser relleno.
//   · Ref visible. Sin ella el colega no puede referenciar la propiedad ni
//     cruzarla contra lo que ya vio en otro grupo.
//   · Operacion explicita. Hoy el inventario es 100% venta, pero el dia que
//     entre arriendo un "$2.200.000" sin la palabra arriendo se lee como una
//     venta absurda.
//
// CAMBIO DELIBERADO (Juan, 2026-08-18) — "MENSAJE BLANQUEADO":
//
// Hasta esta fecha el mensaje llevaba el link a la landing propia y cerraba
// derivando a la asesora ("Mas informacion con Catherine: wa.me/...") firmado
// como "Sofi, asistente de Diamond Inmobiliaria". Juan pidio explicitamente
// lo contrario: el colega reenvia este mensaje TAL CUAL a su propio cliente
// final, asi que no puede llevar nada que identifique a Diamond — ni el link
// propio, ni el contacto de la asesora, ni "Diamond" en la firma.
//
//   · Link: linkWasi (el original de Wasi, ver withLandingLink en
//     src/data/properties.js), NO `link` (la landing propia). Es lo opuesto
//     de la regla de siempre para cualquier OTRO mensaje del sistema — sigue
//     valiendo en todos lados menos aca.
//   · Sin derivar a la asesora: el colega identifica con quien hablar por el
//     numero de WhatsApp que publico el mensaje en el grupo, no por un link
//     en el texto.
//   · Firma "Sofi, asistente virtual" — sin "de Diamond Inmobiliaria".
//
// Juan lo pidio con el riesgo explicito sobre la mesa: sin mencion a Diamond
// en el mensaje, no queda gancho de comision compartida si el colega cierra
// el negocio por su cuenta. Decision de negocio, no un descuido.
//
// AJUSTE (Juan, 2026-08-20): la firma "Sofi, asistente virtual" ahora lleva
// el link de WhatsApp de Sofi ("para mayor informacion o propiedades
// similares") — el mismo numero publico que ya usa la landing
// (web/config/tenants/diamond.ts). No es un retroceso del blanqueado: el
// texto sigue sin decir "Diamond" en ningun lado, solo abre un canal directo
// con el asistente para quien quiera seguir la conversacion.

const formato = require("../lib/formato");

// Mismo numero que web/config/tenants/diamond.ts (contact.whatsapp.number) —
// no hay todavia un lugar unico de donde leerlo en el backend, asi que se
// declara aca con el mismo valor. Configurable para no tener que redesplegar
// si cambia.
const SOFI_WHATSAPP_NUMBER = process.env.SOFI_WHATSAPP_NUMBER || "573044653609";
const SOFI_WHATSAPP_MENSAJE = "Hola, vi una propiedad en el grupo y quiero mas informacion o propiedades similares";

// SIN TOPE (Juan, 2026-08-20): "que no se restrinja a 3, que se envien los
// que tengan un scoring alto" — se manda TODO lo que ya paso la compuerta de
// calidad de src/groups/publicable.js (puntaje >= umbral, zona exacta o
// vecina, datos limpios). Esa compuerta es la que de verdad decide "esto es
// bueno", no un limite fijo de cantidad. Se deja el parametro por si algun
// dia hace falta acotar de nuevo, pero el default ya no trunca.
const MAX_PROPIEDADES = Infinity;

function primerNombre(nombre) {
  const limpio = String(nombre || "").trim();
  if (!limpio) return null;
  // Los nombres de WhatsApp traen emojis y adornos; si no queda nada usable, se
  // saluda sin nombre antes que saludar a "🏠🔥".
  const palabra = limpio.split(/\s+/)[0].replace(/[^\p{L}\p{M}'-]/gu, "");
  if (palabra.length < 2) return null;
  // Se normaliza la capitalizacion: en la base la asesora esta como "katherine
  // Uribe" (minuscula), y los nombres de WhatsApp vienen en MAYUSCULAS a menudo.
  return palabra.charAt(0).toLocaleUpperCase("es-CO") + palabra.slice(1).toLocaleLowerCase("es-CO");
}

// Algunos titulos de Wasi son una sola palabra generica —"Apartamento", "Casa"—
// porque el asesor no llenó el campo. Publicado en un grupo, "1) Apartamento" no
// le dice nada a nadie y se lee como un volcado automatico. Cuando pasa, se
// compone con la zona, que es el dato que el colega esta buscando.
const TITULOS_GENERICOS = new Set([
  "apartamento", "casa", "local", "oficina", "lote", "finca", "bodega", "apartaestudio", "consultorio",
]);

function tituloUtil(match) {
  const titulo = formato.normalizarTitulo(match.titulo);
  if (!titulo) return null;
  const zona = String(match.zona || "").trim();
  if (zona && TITULOS_GENERICOS.has(titulo.toLocaleLowerCase("es-CO"))) {
    return `${titulo} en ${zona}`;
  }
  return titulo;
}

// Ficha completa (Juan, 2026-08-20): titulo / ref+operacion+zona /
// medidas+precio / banos+garajes+estrato (si el inventario los tiene) / link.
//
// El link es linkWasi (no `link`) — ver la nota de "MENSAJE BLANQUEADO" arriba.
// publicable.js ya garantizo que existe (motivo sin_link_wasi) antes de que
// una propiedad llegue hasta aca.
function ficha(match, indice) {
  const titulo = tituloUtil(match);
  const operacion = String(match.operacion || "").trim();
  const zona = String(match.zona || "").trim();

  const identidad = [`Ref ${match.ref}`, operacion || null, zona || null].filter(Boolean).join(" · ");

  const medidas = [
    formato.formatearArea(match.area),
    formato.pluralizar(match.habitaciones, "alcoba"),
    formato.formatearPrecio(match.precio),
  ]
    .filter(Boolean)
    .join(" · ");

  // Solo si el inventario los tiene: un hueco de sync no se disfraza de "0
  // baños" o "estrato 0", que es peor que no decir nada (ver la misma regla
  // en las exigencias de match.js).
  const detalles = [
    formato.pluralizar(match.banos, "baño", "baños"),
    formato.pluralizar(match.garajes, "garaje"),
    match.estrato > 0 ? `estrato ${match.estrato}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const lineas = [`${indice}) ${titulo}`, `   ${identidad}`, `   ${medidas}`];
  if (detalles) lineas.push(`   ${detalles}`);
  lineas.push(`   ${match.linkWasi}`);
  return lineas.join("\n");
}

// Devuelve el texto listo para publicar, o null si no hay nada que decir.
//
// No recibe (ni deriva a) ningun asesor a proposito: es el mensaje
// "blanqueado" que el colega reenvia tal cual a su cliente, y no puede
// llevar nada que identifique a Diamond — ver la nota arriba.
function mensajeGrupo(senal, publicables, { maxPropiedades = MAX_PROPIEDADES } = {}) {
  const props = (publicables || []).slice(0, maxPropiedades);
  if (props.length === 0) return null;

  const nombre = primerNombre(senal && senal.autor_nombre);
  const saludo = nombre ? `Hola ${nombre}, vi tu solicitud.` : "Hola, vi tu solicitud.";
  const encabezado =
    props.length === 1
      ? `${saludo} Tengo esta opcion que puede servirte:`
      : `${saludo} Tengo ${props.length} opciones que pueden servirte:`;

  const bloques = props.map((m, i) => ficha(m, i + 1));

  const cierre = [
    "Comision compartida.",
    // "Sofi, asistente virtual" y nada mas: sin "de Diamond Inmobiliaria". El
    // colega identifica a quien responder por el numero de WhatsApp que
    // publico esto en el grupo, no por un nombre o link en el texto.
    "— Sofi, asistente virtual",
    `Mas informacion o propiedades similares: https://wa.me/${SOFI_WHATSAPP_NUMBER}?text=${encodeURIComponent(SOFI_WHATSAPP_MENSAJE)}`,
  ];

  return [encabezado, "", bloques.join("\n\n"), "", cierre.join("\n")].join("\n");
}

module.exports = { mensajeGrupo, ficha, primerNombre, tituloUtil, MAX_PROPIEDADES };
