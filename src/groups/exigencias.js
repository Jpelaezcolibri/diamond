// Las exigencias de un pedido —alcobas, area, baños, garajes, estrato— en un
// solo lugar.
//
// POR QUE EXISTE (auditoria del motor de match 2026-09-05, H6, la mitad que
// quedo abierta). La misma lista de campos vivia escrita en cinco archivos:
// el motor (match.js), lo que ve Sofi (revalidar.js), el resumen para la
// asesora (pedido.js), el carril de compra (cruce-mandatos.js) y el
// clasificador. Cada uno la recorria a su manera, y el nombre de un mismo
// dato cambia segun de donde venga: el pedido dice `garajes`, la fila de
// `properties` dice `garaje`, el match y las ofertas de colegas dicen
// `garajes`. Agregar una exigencia (o renombrar una) obligaba a acordarse de
// los cinco lugares; olvidarse de uno no falla, solo deja de mirar ese dato.
//
// Lo que vive aca: QUE se exige, con que nombre llega del pedido y de la
// propiedad, y como se dice en voz alta. Lo que NO vive aca: las REGLAS de
// cada lector. El motor castiga quedarse corto, el carril de compra lo anota
// como salvedad, Sofi lo juzga. Esas diferencias son a proposito y siguen en
// su archivo.

const formato = require("../lib/formato");

const EXIGENCIAS = [
  {
    campo: "habitaciones",
    enPropiedad: ["habitaciones"],
    rotuloSofi: "alcobas",
    paraSofi: (v, c) => `${v}${c && c.flexible_habitaciones ? " (acepta una menos si tiene estudio)" : ""}`,
    resumen: (v, c) => `${formato.pluralizar(v, "alcoba")}${c && c.flexible_habitaciones ? " (o una menos con estudio)" : ""}`,
  },
  {
    campo: "area_min",
    enPropiedad: ["area"],
    rotuloSofi: "area minima",
    paraSofi: (v) => `${v} m²`,
    resumen: (v) => `desde ${v} m²`,
  },
  {
    campo: "banos",
    enPropiedad: ["banos"],
    rotuloSofi: "baños",
    paraSofi: (v) => `${v}`,
    resumen: (v) => formato.pluralizar(v, "baño", "baños"),
  },
  {
    // La fila de `properties` dice `garaje`; el match (evaluarCandidata) y
    // las ofertas de colegas dicen `garajes`. Se lee el primero que exista.
    campo: "garajes",
    enPropiedad: ["garaje", "garajes"],
    rotuloSofi: "garajes",
    paraSofi: (v) => `${v}`,
    resumen: (v) => formato.pluralizar(v, "garaje"),
  },
  {
    campo: "estrato",
    enPropiedad: ["estrato"],
    rotuloSofi: "estrato",
    paraSofi: (v) => `${v}`,
    resumen: (v) => `estrato ${v}`,
  },
];

const POR_CAMPO = new Map(EXIGENCIAS.map((e) => [e.campo, e]));

function exigencia(campo) {
  const e = POR_CAMPO.get(campo);
  if (!e) throw new Error(`Exigencia desconocida: ${campo}`);
  return e;
}

// Lo que pidio el colega para esa exigencia (el campo del clasificador).
function pedido(c, campo) {
  return (c || {})[exigencia(campo).campo];
}

// Lo que tiene la propiedad, CRUDO (sin parsear: el area de Wasi es "92m2" y
// cada lector decide como leerla). Con varios nombres posibles se toma el
// primero que traiga valor; si ninguno trae, el del nombre principal.
function dePropiedad(p, campo) {
  const x = p || {};
  const nombres = exigencia(campo).enPropiedad;
  for (const n of nombres) {
    if (x[n] !== undefined && x[n] !== null) return x[n];
  }
  return x[nombres[0]];
}

// Las lineas del pedido que ve Sofi, con "no dice" donde el colega no pidio
// nada: "no dice" no es una exigencia (ver el prompt de revalidar.js).
function lineasParaSofi(c) {
  const x = c || {};
  return EXIGENCIAS.map((e) => {
    const v = x[e.campo];
    return `- ${e.rotuloSofi}: ${v ? e.paraSofi(v, x) : "no dice"}`;
  });
}

// El resumen para la asesora: solo lo que el pedido menciono (null donde no),
// porque una linea con huecos ("0 alcobas") es peor que no ponerla.
function resumen(s) {
  const x = s || {};
  return EXIGENCIAS.map((e) => (formato.datoCargado(x[e.campo]) ? e.resumen(x[e.campo], x) : null));
}

module.exports = { EXIGENCIAS, exigencia, pedido, dePropiedad, lineasParaSofi, resumen };
