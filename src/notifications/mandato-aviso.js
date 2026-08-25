// src/notifications/mandato-aviso.js
//
// El aviso que recibe el asesor cuando una oferta de un colega cruza con uno de
// sus mandatos de compra. Puro: recibe hechos, devuelve texto.
//
// TRES REGLAS QUE NO SE NEGOCIAN, cada una por un caso real:
//
// 1. NUNCA se dice que la propiedad esta disponible. El radar leyo un mensaje en
//    un grupo; no verifico nada. Una oferta recomendada como disponible cuando no
//    lo esta es el daño de reputacion que la caducidad de ally_properties existe
//    para evitar.
// 2. NUNCA se manda un puntaje. Un "92%" no le dice al asesor que preguntarle al
//    colega; "sin verificar: vista y balcon" si. Misma leccion que las salvedades
//    del carril de venta.
// 3. Sin telefono marcable NO se inventa un numero ni se muestra el LID crudo
//    (14-17 digitos, ver src/lib/contacto.js). Se da la salida que si funciona
//    desde el celular: tocar el nombre del colega en el grupo. Es la politica de
//    Juan del 2026-08-22, que nacio de links muertos y avisos que decian "no hay
//    telefono" cuando el numero nunca se habia intentado resolver.
const { tocarNombreEnGrupo } = require("../lib/contacto");

function fichaDe(oferta) {
  const partes = [
    oferta.precio || null,
    oferta.area ? `${oferta.area} m²` : null,
    oferta.habitaciones ? `${oferta.habitaciones} alcobas` : null,
    oferta.banos ? `${oferta.banos} baños` : null,
    oferta.garajes ? `${oferta.garajes} garajes` : null,
    oferta.estrato ? `estrato ${oferta.estrato}` : null,
  ].filter(Boolean);
  return partes.join(" · ");
}

function horaBogota(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("es-CO", {
      timeZone: "America/Bogota", day: "numeric", month: "short",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function buildMandatoMatchAlert({ mandato, oferta, evaluacion, colega = {}, grupo = null, vistoEnIso = null }) {
  const cliente = mandato.cliente_nombre || "un cliente tuyo";
  const tipo = oferta.tipo || "Propiedad";
  const operacion = oferta.operacion ? ` en ${String(oferta.operacion).toLowerCase()}` : "";
  const zona = oferta.zona ? ` — ${oferta.zona}` : "";

  const quien = colega.nombre || "Un colega";
  const contacto = colega.telefono
    ? `Teléfono: +${colega.telefono}`
    // tocarNombreEnGrupo ya devuelve la frase completa y YA dice "en el grupo"
    // (src/lib/contacto.js). Concatenarle " en el grupo X" produce "...en el grupo
    // para abrirle el chat directo ... en el grupo SOLO POBLADO". El nombre del
    // grupo lo da la linea "Visto en:" de mas abajo, que ya existe.
    : `El colega no dejó número visible — ${tocarNombreEnGrupo(quien)}.`;

  const visto = [grupo ? `Visto en: ${grupo}` : null, horaBogota(vistoEnIso) || null]
    .filter(Boolean).join(" · ");

  const lineas = [
    `🎯 Oferta nueva que le sirve a ${cliente}`,
    "",
    `${tipo}${operacion}${zona}`,
    fichaDe(oferta),
  ];
  if (oferta.link) lineas.push(`Ficha: ${oferta.link}`);
  lineas.push("", `Colega: ${quien}`, contacto);
  if (visto) lineas.push(visto);
  lineas.push("");
  if (evaluacion.cumple.length) lineas.push(`Cumple: ${evaluacion.cumple.join(", ")}.`);
  if (evaluacion.salvedades.length) lineas.push(`Ojo: ${evaluacion.salvedades.join(". ")}.`);
  lineas.push(
    "",
    "Confirmá disponibilidad y precio con el colega antes de mostrárselo al cliente.",
    // Regla de negocio de Juan: el sistema no reparte comisiones.
    "La comisión se comparte: quien tiene el cliente y quien tiene la propiedad se ponen de acuerdo.",
    "",
    // Doble trabajo: registra que paso con la oportunidad Y renueva la ventana de
    // 24h de Meta, que es lo unico que mantiene el canal abierto para el proximo
    // match (los mensajes de Sofi NO la renuevan, solo los del asesor).
    "Contame cómo te fue con una respuesta corta."
  );
  return lineas.filter((l) => l !== undefined).join("\n");
}

/**
 * Los {{1}} {{2}} {{3}} de la plantilla `radar_match_mandato`. Meta rechaza
 * parametros vacios y con saltos de linea, asi que los tres van garantizados
 * con contenido y en una sola linea.
 *
 * La plantilla NO lleva link ni telefono a proposito: el detalle sale por texto
 * libre una vez que el asesor responde y abre la ventana.
 */
function paramsPlantilla({ mandato, oferta }) {
  const limpiar = (s, fallback) => String(s || "").replace(/\s+/g, " ").trim() || fallback;
  return [
    limpiar(mandato.cliente_nombre, "un cliente tuyo"),
    limpiar([oferta.tipo, oferta.precio].filter(Boolean).join(" "), "una propiedad"),
    limpiar(oferta.zona || oferta.ciudad, "Medellín"),
  ];
}

module.exports = { buildMandatoMatchAlert, paramsPlantilla };
