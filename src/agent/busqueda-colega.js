// La busqueda de Sofi con un colega respeta su pedido (caso Juan Felipe,
// 2026-10-26). El radar le mando la 10013440 (Robledo, $250M) para un pedido de
// Buenos Aires/Villa Hermosa/Boston/Robledo hasta $270M, y cuando pidio "otra
// parecida" Sofi le ofrecio Loma del Indio por $640M y Envigado por $520M:
// buscar_propiedades no sabia nada del pedido.
//
// La regla es la del motor ("lo que es zonas, pisos, parqueaderos, hazlo
// literal; a los numeros dales un pequeño margen"), asi que el juez es el
// mismo: match.evaluarCandidata contra el pedido guardado. Pasa la zona exacta
// o la general; la cercana solo si el colega no es tajante, y con aclaracion.
// Lo de otra zona o fuera del tope no llega al modelo.
//
// Se salta con una ref puntual (la pidio el) o con fuera_del_pedido, que Sofi
// marca solo cuando el colega pidio en el chat ampliar la zona o el tope.
const supabase = require("../data/supabase");
const memory = require("../data/memory");
const match = require("../groups/match");
const publicable = require("../groups/publicable");

const COLUMNAS_PEDIDO =
  "id, texto_original, operacion, tipo, zona, zonas, zonas_excluidas, ciudad, precio_min, precio_max, habitaciones, flexible_habitaciones, area_min, banos, garajes, estrato, amoblado, periodo, piso_min, piso_max";

const GRADOS_DEL_PEDIDO = new Set(["exacta", "zona_general"]);

async function cargarPedido(orgId, id) {
  if (!id) return null;
  if (!supabase) return (memory.groupSignals || []).find((s) => s.org_id === orgId && s.id === id) || null;
  const { data, error } = await supabase.from("group_signals").select(COLUMNAS_PEDIDO).eq("org_id", orgId).eq("id", id).maybeSingle();
  if (error) {
    console.warn("[busqueda-colega] No se pudo leer el pedido:", error.message);
    return null;
  }
  return data || null;
}

// El pedido sirve de filtro solo si trae zona o tope: sin eso no hay nada
// literal que respetar.
function pedidoFiltra(pedido) {
  if (!pedido) return false;
  const zonas = Array.isArray(pedido.zonas) ? pedido.zonas.filter(Boolean) : [];
  return Boolean(pedido.zona || pedido.ciudad || zonas.length || Number(pedido.precio_max) > 0);
}

// Devuelve { quedan, fuera }. Cada propiedad que queda lleva `calce_pedido`
// ("exacta" | "zona_cercana") para que Sofi aclare la cercana.
function filtrar(propiedades, pedido) {
  const cercanaOk = !publicable.colegaTajante({ texto: pedido.texto_original });
  const quedan = [];
  let fuera = 0;
  for (const p of propiedades) {
    const m = match.evaluarCandidata(p, pedido, "diamond");
    const grado = m && m.ubicacion;
    if (grado && GRADOS_DEL_PEDIDO.has(grado)) quedan.push({ ...p, calce_pedido: "exacta" });
    else if (grado === "vecina" && cercanaOk) quedan.push({ ...p, calce_pedido: "zona_cercana" });
    else fuera++;
  }
  // Primero las de la zona pedida.
  quedan.sort((a, b) => (a.calce_pedido === b.calce_pedido ? 0 : a.calce_pedido === "exacta" ? -1 : 1));
  return { quedan, fuera };
}

function resumenPedido(pedido) {
  const zonas = (Array.isArray(pedido.zonas) && pedido.zonas.filter(Boolean).length ? pedido.zonas : [pedido.zona || pedido.ciudad]).filter(Boolean).join(", ");
  const tope = Number(pedido.precio_max) > 0 ? `hasta $${Number(pedido.precio_max).toLocaleString("es-CO")}` : "";
  return [zonas, tope].filter(Boolean).join(", ");
}

function textoSinResultados(pedido) {
  return `No hay propiedades del inventario que calcen con el pedido del colega (${resumenPedido(pedido)}). Las que encontró la búsqueda quedan fuera de su zona o de su tope y NO se le ofrecen. Dile que en este momento no tenemos otra dentro de lo que pidió y pregúntale si su cliente puede ampliar la zona o el presupuesto. Si te dice que sí, vuelve a buscar con fuera_del_pedido: true y con la zona o el tope nuevos.`;
}

module.exports = { cargarPedido, pedidoFiltra, filtrar, textoSinResultados, resumenPedido, COLUMNAS_PEDIDO };
