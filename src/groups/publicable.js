// Compuerta de calidad: decide si una propiedad puede salir en un mensaje
// publico dentro de un grupo gremial.
//
// Por que existe: un mensaje en un grupo de 80 inmobiliarias competidoras se ve
// una vez y no se borra. La auditoria del 2026-08-16 encontro TRES caminos
// abiertos para publicar un dato falso, todos sin fallar ruidosamente:
//
//   1. La ref 9921388 tiene precio errado en Wasi (pendiente hace semanas) y
//      su titulo dice "Urbanizacion Santa Ana" mientras el link apunta a
//      "loma-de-los-balsos". Un colega de El Poblado lo ve en dos segundos.
//   2. Los precios en "$0" (label vacio en Wasi) se parseaban a 0, que es
//      falsy: burlaban el filtro de presupuesto y se ofrecian sin precio.
//   3. Una propiedad vendida cuyo `link` no sea de Wasi NUNCA se marca como no
//      disponible (dmap/src/sync/wasi-api.source.ts:271-279 exige que el link
//      matchee /info\.wasi\.co|\.inmo\.co/). Queda disponible para siempre.
//
// El criterio es deliberadamente severo: ante la duda, NO se publica. Perder un
// match es gratis; publicar un disparate cuesta la reputacion, y la reputacion
// no la protege ninguna linea desechable.

const formato = require("../lib/formato");

// Score minimo para publicar. Ojo con leer este numero como un porcentaje: la
// escala de match.js NO va de 0 a 100, va de 55 a 100. Un match ya pasó TODAS
// las compuertas duras (operacion, tipo, token exacto de zona, banda de precio)
// solo para existir con 55. Los puntos de arriba premian cuanto del pedido se
// pudo VERIFICAR, no cuanto mejor es la propiedad.
//
// Medido contra el inventario real el 2026-08-16 (108 propiedades disponibles):
//   · Techo observado sin pedir alcobas: 73  (55 + 10 presupuesto + 8 area)
//   · Techo observado pidiendo alcobas:  83  (+10)
//   · garaje sincronizado en 29/108, estrato en 33/108 → esos puntos casi nunca
//     se pueden ganar, y el pedido del ejemplo ("con parqueadero") depende de
//     garaje.
// Con el umbral en 80 el bot quedaba mudo ante la demanda que motivo el modulo.
// 70 deja pasar los matches que cumplieron todo lo verificable; la calidad del
// DATO la garantizan las demas reglas de este archivo, no el puntaje.
// Se sube o baja con GRUPOS_RESPUESTA_UMBRAL sin tocar codigo ni redesplegar.
const UMBRAL_DEFAULT = Number(process.env.GRUPOS_RESPUESTA_UMBRAL || 70);

// Rangos sanos por operacion, en COP. No son limites de negocio sino detectores
// de dato corrupto: fuera de aqui, el numero casi seguro es un typo o el bug de
// digitos concatenados. Un garaje suelto ronda los 40M; el arriendo mas barato
// que publica una inmobiliaria formal no baja de ~300k.
const RANGOS = {
  venta: { min: 30_000_000, max: 100_000_000_000 },
  arriendo: { min: 300_000, max: 100_000_000 },
};

// Refs que no se publican aunque pasen todo lo demas. Se corrigen en Wasi y se
// sacan de aqui; mientras tanto, no salen.
const REFS_BLOQUEADAS = new Set(
  (process.env.GRUPOS_REFS_BLOQUEADAS || "9921388")
    .split(",")
    .map((r) => r.trim().toUpperCase())
    .filter(Boolean)
);

// El link SIEMPRE debe ser el de la landing propia. Mandar al colega a Wasi es
// regalarle la marca, y ademas delata de donde sale el inventario.
const DOMINIO_AJENO = /info\.wasi\.co|\.inmo\.co/i;

function rangoDe(operacion) {
  return String(operacion || "").toLowerCase().includes("arriendo") ? RANGOS.arriendo : RANGOS.venta;
}

// Devuelve { ok, motivos } — `motivos` lista TODO lo que falla, no solo lo
// primero, para poder auditar la calidad del inventario con una sola pasada.
function esPublicable(match, { umbral = UMBRAL_DEFAULT, syncFresco = true, refsBloqueadas = REFS_BLOQUEADAS } = {}) {
  const motivos = [];
  if (!match) return { ok: false, motivos: ["sin_match"] };

  // Nunca se publica inventario de un aliado: el aliado puede estar leyendo ese
  // mismo grupo, y Diamond quedaria de intermediaria en un negocio ajeno.
  if (match.fuente !== "diamond") motivos.push("no_es_inventario_propio");

  // AQUI SE CONSERVA LA LECCION DE JULIO. Desde el 2026-08-18 la zona dejo de
  // ser compuerta en match.js: una propiedad de otro barrio entra marcada como
  // `otra_zona` para que Sofi pueda razonar si le sirve al cliente.
  //
  // Eso vale para el AVISO a la asesora, que pasa por Sofi y por una persona.
  // Para PUBLICAR en un grupo gremial NO: ahi no hay nadie revisando, y ofrecer
  // Robledo a quien pidio Laureles delante de 80 competidores es exactamente el
  // falso positivo que costo 656 de 731 matches en julio.
  //
  // Se aceptan `exacta` y `vecina` —contigüidad real, declarada en
  // src/lib/zonas.js— y nada mas. `ciudad` tampoco: un pedido sin barrio no
  // habilita a publicar media Medellin.
  if (match.ubicacion && !["exacta", "vecina"].includes(match.ubicacion)) {
    motivos.push("zona_no_publicable");
  }

  if (!(Number(match.puntaje) >= umbral)) motivos.push("puntaje_bajo");

  const ref = String(match.ref || "").trim();
  if (!ref) motivos.push("sin_ref");
  else if (refsBloqueadas.has(ref.toUpperCase())) motivos.push("ref_bloqueada");

  if (!formato.normalizarTitulo(match.titulo)) motivos.push("sin_titulo");

  const precio = formato.parsearPrecio(match.precio);
  if (precio === null) {
    motivos.push("sin_precio");
  } else {
    const rango = rangoDe(match.operacion);
    if (precio < rango.min || precio > rango.max) motivos.push("precio_fuera_de_rango");
  }

  if (!String(match.zona || "").trim()) motivos.push("sin_zona");
  if (formato.parsearArea(match.area) === null) motivos.push("sin_area");

  const link = String(match.link || "").trim();
  if (!link) motivos.push("sin_link");
  else if (DOMINIO_AJENO.test(link)) motivos.push("link_ajeno");

  // El mensaje que de verdad se publica usa linkWasi, no `link` (Juan,
  // 2026-08-18 — ver la nota de diseño en redactar.js). `withLandingLink`
  // siempre arma un `link` propio aunque Wasi no haya traido ninguno, asi
  // que validar solo `link` no alcanza: sin esto, una propiedad sin link de
  // Wasi pasaria la compuerta y saldria al grupo con un renglon vacio.
  if (!String(match.linkWasi || "").trim()) motivos.push("sin_link_wasi");

  // Si el sync de Wasi esta detenido, todo el inventario es sospechoso: no se
  // sabe que se vendio desde entonces. DMAP ya se detuvo 16 dias sin que nadie
  // se enterara (auditoria del 2026-08-01).
  if (!syncFresco) motivos.push("sync_viejo");

  return { ok: motivos.length === 0, motivos };
}

// Filtra una lista de matches y devuelve los publicables (ya ordenados por
// puntaje) mas el detalle de los descartes, que sirve para auditar por que un
// pedido no se respondio.
//
// SIN TOPE por defecto (Juan, 2026-08-20): antes se cortaba en 3 aca mismo,
// antes de que redactar.js pudiera decidir nada. Ahora se manda TODO lo que
// paso la compuerta de calidad — es ella la que decide "esto es bueno", no
// un limite fijo de cantidad. `matches` ya viene acotado a 6 candidatas desde
// match.js#cruzarDemanda, asi que el techo real sigue existiendo, solo que
// no es un numero arbitrario despues de filtrar por calidad.
function filtrar(matches, opciones = {}) {
  const limite = opciones.limite || Infinity;
  const publicables = [];
  const descartados = [];

  for (const m of matches || []) {
    const veredicto = esPublicable(m, opciones);
    if (veredicto.ok) publicables.push(m);
    else descartados.push({ ref: m && m.ref, motivos: veredicto.motivos });
  }

  publicables.sort((a, b) => Number(b.puntaje) - Number(a.puntaje));
  return { publicables: publicables.slice(0, limite), descartados };
}

// QUE SIGNIFICA CADA MOTIVO, EN CASTELLANO (Juan, 2026-09-06).
//
// BUG REAL. Juan le pidio a Sofi que le mandara al colega la 9921388, la de
// Loma de los Balsos, que era la que mejor calzaba. No salio, y Sofi le
// contesto que el colega "no tiene telefono registrado en el sistema". Eso era
// falso por partida doble: el DM a ese colega YA habia salido esa mañana por
// lid (politica_traza: destino:lid), y la razon real de que esa ref no fuera
// era otra — esta en esta lista: ref_bloqueada.
//
// Los motivos son identificadores para el codigo. Cuando salen hacia una
// persona tienen que decir algo que esa persona pueda ACCIONAR, y sobre todo
// tienen que salir: un motivo que no se traduce es un motivo que quien lo lea
// va a reemplazar por una explicacion inventada.
const MOTIVOS_LEGIBLES = {
  ref_bloqueada: "esta apartada a proposito porque tiene un dato mal cargado en Wasi (GRUPOS_REFS_BLOQUEADAS). Se corrige en Wasi y se saca de la lista; mientras tanto no sale a ningun colega",
  no_es_inventario_propio: "es de la red de aliados, no es nuestra: no se ofrece en el gremio",
  zona_no_publicable: "la zona no calza con lo que pidio el colega",
  puntaje_bajo: "el puntaje quedo por debajo del umbral para salir sola",
  sin_ref: "no tiene referencia",
  sin_titulo: "no tiene titulo cargado",
  sin_precio: "no tiene precio cargado",
  precio_fuera_de_rango: "el precio esta fuera de rango sano: casi seguro es un dato corrupto en Wasi",
  sin_zona: "no tiene zona cargada",
  sin_area: "no tiene area cargada",
  sin_link: "no tiene link propio",
  link_ajeno: "el link apunta a un dominio que no es el nuestro",
  sin_link_wasi: "no tiene link de Wasi para verificar",
  link_no_abre: "el link no abre",
  sync_viejo: "el sync de Wasi esta viejo, asi que el dato puede no ser el actual",
};

// Traduce una lista de motivos. Un motivo que no este en el mapa se devuelve
// crudo: es preferible un identificador feo a que quien lo lea no reciba nada.
function explicarMotivos(motivos) {
  return (motivos || []).map((m) => MOTIVOS_LEGIBLES[m] || m).join("; ");
}

module.exports = { esPublicable, filtrar, UMBRAL_DEFAULT, RANGOS, REFS_BLOQUEADAS, MOTIVOS_LEGIBLES, explicarMotivos };
