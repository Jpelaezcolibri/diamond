// El aviso de un pedido que el COLEGA le escribio directo a Sofi.
//
// POR QUE ESTA ACA Y NO INLINE (2026-09-15). El texto vivia dentro de
// src/agent/tools.js#avisarDemandaColegaInmediata, que era el unico que lo
// mandaba. Desde que el anti-rafaga dejo de descartar el segundo pedido de un
// colega, hay un SEGUNDO camino que lo manda: la bandeja de salida
// (src/scheduler/avisos-salida.js) levanta los que quedaron pendientes.
//
// Dos caminos con el mismo mensaje es exactamente como divergieron los tres
// caminos del DM al colega antes de que existiera envio-colega.js. Asi que el
// texto se arma en un solo lugar y los dos lo usan igual.
//
// Es puro: recibe datos ya resueltos y devuelve texto. No consulta, no envia.

// Una candidata, en una linea. La asesora ya conoce el inventario: necesita
// reconocerla y tener el link a mano, no la ficha entera.
function lineaMatch(m) {
  const partes = [
    m.ref ? `ref ${m.ref}` : "sin ref",
    m.zona || "sin zona",
    m.precio || "sin precio",
  ];
  return `- ${partes.join(" · ")}${m.link ? `\n  ${m.link}` : ""}`;
}

/**
 * @param contacto       nombre del colega
 * @param telefono       su celular ya resuelto, o null
 * @param tipo           "apartamento", "casa"…
 * @param zona           zona o ciudad del pedido
 * @param notas          el detalle corto que extrajo el clasificador
 * @param textoOriginal  lo que el colega escribio, tal cual
 * @param matches        candidatas [{ ref, zona, precio, link }]
 */
function construir({ contacto, telefono = null, tipo = null, zona = null, notas = null, textoOriginal = null, matches = [] } = {}) {
  const quien = String(contacto || "").trim() || "un colega";
  const que = [tipo, zona].filter(Boolean).join(" en ") || "algo sin detalle";
  // "sin telefono" y no un numero inventado: si no lo tenemos, que se vea.
  const telefonoLinea = telefono ? `+${telefono}` : "sin telefono";
  const lista = matches.length ? matches.map(lineaMatch).join("\n") : "No calza nada del inventario todavia.";
  const pedido = String(textoOriginal || "").trim();

  return [
    `🔔 Pedido directo de un colega — contactalo`,
    ``,
    `Colega: ${quien} (${telefonoLinea})`,
    `Pide: ${que}`,
    notas ? `Detalle: ${notas}` : null,
    ...(pedido ? [``, `Lo escribió así:`, `"${pedido}"`] : []),
    ``,
    lista,
    ``,
    `Escribile o llamalo vos, no Sofi: es un negocio compartido con otra inmobiliaria, no un cliente propio.`,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

// La entrada del digest cuando hay varios pendientes a la vez: una linea por
// colega, sin fichas. Misma forma que las demas entradas de digest-avisos.js.
function lineaDigest({ contacto, tipo = null, zona = null } = {}) {
  const quien = String(contacto || "").trim() || "un colega";
  const que = [tipo, zona].filter(Boolean).join(" en ") || "algo sin detalle";
  return `▸ ${quien} te escribió directo: ${que}`;
}

module.exports = { construir, lineaDigest };
