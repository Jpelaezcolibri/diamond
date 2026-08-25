// src/groups/cruce-mandatos.js
//
// ¿Esta oferta que publico un colega le sirve a este mandato de compra? Codigo
// PURO: cero base, cero red, cero tokens. Toda la logica delicada del carril de
// compra vive aca, y por eso se puede probar entera.
//
// LA DECISION DE PRODUCTO QUE ORDENA ESTE ARCHIVO (Juan, 2026-08-25): filo bajo,
// salvedades escritas. El sistema no descarta por el asesor — le manda lo que se
// acerca y le dice exactamente que falta. El motivo es que los falsos negativos
// son invisibles por definicion y son los caros: una propiedad que nunca se
// mostro no deja rastro de la comision que no se cobro.
//
// Pero hay un piso, porque un aviso que el asesor aprende a ignorar es peor que
// no mandarlo. Tres cortes duros, y nada mas:
//   1. Operacion — mandarle un arriendo a quien compra rompe la confianza entera.
//   2. Zona — pedida o vecina, con la graduacion que ya tiene ubicacionCoincide.
//   3. Precio — hasta 15% arriba del tope. Mas que eso no es "se acerca".
// Todo lo demas (habitaciones, area, baños, garajes, estrato, exigencias) es
// blando: se manda, con la salvedad escrita.
const match = require("./match");
const formato = require("../lib/formato");

const MARGEN_PRECIO_DEFAULT = Number(process.env.RADAR_MANDATO_MARGEN_PRECIO || 0.15);

const lista = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

/**
 * Traduce un mandato al shape de criterio que espera evaluarCandidata.
 *
 * Es una traduccion de nombres, no de semantica: la tabla se diseño copiando
 * group_signals justamente para que esto sea trivial. Si algun dia deja de ser
 * trivial, el que se movio de lugar es el shape de la tabla.
 */
function criterioDeMandato(m) {
  return {
    operacion: (m.operacion || "").toLowerCase(),
    tipo: m.tipo || "",
    zonas: lista(m.zonas),
    zona: lista(m.zonas)[0] || "",
    zonas_excluidas: lista(m.zonas_excluidas),
    ciudad: m.ciudad || "",
    precio_min: num(m.precio_min),
    precio_max: num(m.precio_max),
    habitaciones: num(m.habitaciones),
    flexible_habitaciones: Boolean(m.flexible_habitaciones),
    area_min: num(m.area_min),
    banos: num(m.banos),
    garajes: num(m.garajes),
    estrato: num(m.estrato),
  };
}

// El precio de una oferta de grupo es TEXTO ("$1.580.000.000"): ally_properties
// lo guarda asi por el flujo historico. parsearPrecio ya resuelve los formatos
// que aparecen en la practica.
function precioDe(oferta) {
  if (typeof oferta.precio === "number") return oferta.precio;
  return formato.parsearPrecio(oferta.precio) || 0;
}

function fmtPesos(n) {
  return `$${Number(n).toLocaleString("es-CO")}`;
}

/**
 * @param oferta   propiedad del colega, ya normalizada al shape de ally_properties
 * @param mandato  fila de mandatos_compra
 * @returns null si no pasa el piso; si pasa:
 *   { sirve, puntaje, ubicacion, cumple: string[], salvedades: string[] }
 *
 * `cumple` y `salvedades` son frases para leer, no un puntaje. Un "87%" no le
 * dice al asesor que preguntarle al colega; "sin verificar: vista y balcon" si.
 *
 * OJO con `puntaje`: viene de evaluarCandidata pero aca se le pasa un criterio
 * angosto a proposito (ver mas abajo por que). El resultado es que ya NO mide
 * calidad de match en este carril — es practicamente constante (67 con zona
 * exacta) para cualquier oferta que pase el piso, sin discriminar precio ni
 * habitaciones. Se guarda como dato diagnostico (para depurar el motor), pero
 * NO se debe mostrar como "% de match" en ningun panel: seria mostrarle al
 * asesor un numero que no significa lo que el panel diria que significa.
 */
function evaluarOferta(oferta, mandato, { margenPrecio = MARGEN_PRECIO_DEFAULT } = {}) {
  const c = criterioDeMandato(mandato);

  // Corte 1 y 2 (operacion y zona) los hace el motor que ya existe: devuelve
  // null si la operacion no calza, si el tipo no calza o si la ubicacion no
  // coincide ni de vecina. No se reimplementa nada de eso aca.
  //
  // OJO (verificado corriendo el motor real, 2026-08-25): evaluarCandidata
  // trae SUS PROPIOS cortes duros de precio (10%, ver MARGEN_PRECIO) y de
  // habitaciones/baños/garajes (exactos si el pedido no vino marcado
  // flexible_habitaciones) — pensados para el carril de venta, donde son
  // correctos. En el carril de compra esos tres son blandos por decision de
  // producto (ver el comentario de arriba del archivo), asi que NO se le
  // pasan a evaluarCandidata: si se le pasaran, devolveria null antes de que
  // esta funcion pueda escribir la salvedad, y una oferta que "sirve con
  // salvedad" se perderia como si nunca hubiera calzado. Solo viaja lo que
  // sigue siendo corte duro tambien para nosotros: operacion, tipo y zona.
  const criterioCompuertas = {
    operacion: c.operacion,
    tipo: c.tipo,
    zonas: c.zonas,
    zona: c.zona,
    zonas_excluidas: c.zonas_excluidas,
    ciudad: c.ciudad,
  };
  const m = match.evaluarCandidata({ ...oferta, area: oferta.area, garaje: oferta.garajes }, criterioCompuertas, "aliado");
  if (!m) return null;

  const precio = precioDe(oferta);
  const cumple = [];
  const salvedades = [];

  // Corte 3: precio. Se evalua aca y no en el motor porque el motor castiga el
  // precio con puntaje, y aca hace falta un corte duro con un margen explicito.
  if (c.precio_max > 0) {
    if (precio <= 0) {
      // Sin precio en la oferta el corte no puede evaluarse — pero el precio
      // es el dato mas sensible de todos, asi que no se queda callado como si
      // no hubiera nada que decir. Mismo patron que los blandos: "no lo
      // sabemos" explicito, nunca silencio.
      salvedades.push(`No dice el precio (se pidió hasta ${fmtPesos(c.precio_max)})`);
    } else {
      const techo = c.precio_max * (1 + margenPrecio);
      if (precio > techo) return null;
      if (precio > c.precio_max) {
        salvedades.push(`Se pasa ${fmtPesos(precio - c.precio_max)} del tope de ${fmtPesos(c.precio_max)}`);
      } else if (precio < c.precio_max * match.BANDA_INFERIOR) {
        // Filo bajo: NO se descarta (en El Poblado esto casi siempre es un
        // precio mal capturado en la publicacion, no un hallazgo real), pero
        // tampoco se afirma que cumple presupuesto sin que nadie lo confirme.
        salvedades.push(
          `El precio publicado (${fmtPesos(precio)}) está muy por debajo del tope pedido (${fmtPesos(c.precio_max)}) — confirmá con el colega que el precio de la publicación sea correcto`
        );
      } else {
        const holgura = c.precio_max - precio;
        cumple.push(holgura > 0 ? `presupuesto (${fmtPesos(holgura)} por debajo del tope)` : "presupuesto");
      }
    }
  }

  // Piso explicito que puso el cliente (precio_min), distinto de la banda del
  // 60% de arriba: ese es un umbral heuristico nuestro, este es un numero que
  // el cliente pidio literalmente. Si la oferta cae debajo, se avisa.
  if (c.precio_min > 0 && precio > 0 && precio < c.precio_min) {
    salvedades.push(`El precio (${fmtPesos(precio)}) está por debajo del piso pedido de ${fmtPesos(c.precio_min)}`);
  }

  // Ubicacion: se dice el grado, no se esconde. "vecina" no es "exacta" y el
  // asesor tiene que poder verlo antes de llamar.
  if (m.ubicacion === "exacta") cumple.push(`sector (${oferta.zona})`);
  else salvedades.push(`La zona es ${oferta.zona} — no es exactamente lo pedido (${lista(mandato.zonas).join(", ")})`);

  // Habitaciones, area, baños, garajes, estrato: blandos. Un dato ausente NO se
  // reporta como cumplido — es la diferencia entre "no lo sabemos" y "lo tiene",
  // y confundirlas es lo que hace que un asesor descubra el problema recien
  // frente al cliente.
  // Las tres frases de cada blando son explicitas y no se derivan una de otra con
  // regex: cada una la va a leer una persona que tiene que decidir si llama al
  // colega, y "No dice (246 m² de 150 pedidos)" no es una frase.
  const blandos = [
    {
      pedido: c.habitaciones, tiene: num(oferta.habitaciones),
      esHabitaciones: true,
      cumple: (v) => `${v} habitaciones`,
      corto: (v, p) => `Tiene ${v} de las ${p} habitaciones pedidas`,
      sinDato: (p) => `No dice cuántas habitaciones tiene (se pidieron ${p})`,
    },
    {
      pedido: c.area_min, tiene: num(oferta.area),
      cumple: (v) => `área (${v} m² de ${c.area_min} pedidos)`,
      corto: (v, p) => `Tiene ${v} m² de los ${p} pedidos`,
      sinDato: (p) => `No dice el área (se pidieron ${p} m²)`,
    },
    {
      pedido: c.banos, tiene: num(oferta.banos),
      cumple: (v) => `${v} baños`,
      corto: (v, p) => `Tiene ${v} de los ${p} baños pedidos`,
      sinDato: (p) => `No dice cuántos baños tiene (se pidieron ${p})`,
    },
    {
      pedido: c.garajes, tiene: num(oferta.garajes),
      cumple: (v) => `${v} garajes`,
      corto: (v, p) => `Tiene ${v} de los ${p} garajes pedidos`,
      sinDato: (p) => `No dice cuántos garajes tiene (se pidieron ${p})`,
    },
    {
      pedido: c.estrato, tiene: num(oferta.estrato),
      cumple: (v) => `estrato ${v}`,
      corto: (v, p) => `Tiene estrato ${v}, se pidió estrato ${p}`,
      sinDato: (p) => `No dice el estrato (se pidió estrato ${p})`,
    },
  ];
  for (const b of blandos) {
    if (b.pedido <= 0) continue;
    if (b.tiene <= 0) salvedades.push(b.sinDato(b.pedido));
    else if (b.tiene >= b.pedido) cumple.push(b.cumple(b.tiene));
    else if (b.esHabitaciones && c.flexible_habitaciones) {
      // flexible_habitaciones significa exactamente esto: el pedido acepta
      // una alcoba menos si hay estudio o servicio que la compense. Sin esto
      // la marca se calculaba y nunca se leia — un mandato flexible y uno que
      // no producian la misma salida.
      salvedades.push(`Tiene ${b.tiene} de las ${b.pedido} habitaciones pedidas, pero el pedido acepta una menos con estudio o servicio`);
    } else salvedades.push(b.corto(b.tiene, b.pedido));
  }

  // Exigencias de texto libre: NUNCA se pueden verificar contra la publicacion
  // de un colega en un grupo. Salen siempre como pendiente de preguntar. Callarlas
  // dejaria que el asesor asuma que estan confirmadas.
  const exigencias = lista(mandato.exigencias);
  if (exigencias.length) salvedades.push(`Sin verificar: ${exigencias.join(", ")}`);

  return { sirve: true, puntaje: m.puntaje, ubicacion: m.ubicacion, cumple, salvedades };
}

module.exports = { evaluarOferta, criterioDeMandato, MARGEN_PRECIO_DEFAULT };
