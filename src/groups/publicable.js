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
function filtrar(matches, opciones = {}) {
  const limite = opciones.limite || 3;
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

module.exports = { esPublicable, filtrar, UMBRAL_DEFAULT, RANGOS, REFS_BLOQUEADAS };
