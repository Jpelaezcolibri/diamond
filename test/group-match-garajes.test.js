// Los parqueaderos son literales (Juan, 2026-09-18).
//
// QUE CAMBIA. El 2026-09-04 se decidio lo contrario: "si no tiene si no un
// parqueadero (...) envialo con la observacion". Quedarse corto solo costaba
// puntos y la propiedad salia igual. Medido entre el 18-ago y el 18-sep: 145
// de las 717 fichas enviadas a colegas salieron con menos parqueaderos de los
// que el pedido exigia. Juan lo revirtio el 18-sep, junto con la zona: "lo que
// es numeros dale un pequeño margen pero lo que es zonas, pisos, parqueaderos,
// etc hazlo literal".
//
// LOS DOS ESTADOS, que no son el mismo (mismo criterio que amoblado.js):
//   · tiene MENOS de los pedidos  -> incumplimiento CONOCIDO: descarta aca.
//   · no trae el dato             -> no se sabe: no descarta, pero marca
//     `garajes_sin_dato` y publicable.js lo frena. La asesora lo ve igual.

const { test } = require("node:test");
const assert = require("node:assert");
const { evaluarCandidata } = require("../src/groups/match");

const pedido = {
  operacion: "venta", tipo: "apartamento", zona: "El Poblado", zonas: ["El Poblado"],
  zonas_excluidas: [], ciudad: "", precio_max: 800000000, precio_min: 0,
  habitaciones: 2, area_min: 0, banos: 0, garajes: 0, estrato: 0, amoblado: "", periodo: "",
};

function propiedad(extra = {}) {
  return {
    ref: "AP100", titulo: "Apartamento en Venta El Poblado", tipo: "Apartamento",
    operacion: "Venta", precio: "$700.000.000", area: "90m2", habitaciones: 3,
    zona: "El Poblado", ciudad: "Medellín", caracteristicas: "Balcón", ...extra,
  };
}

test("pide 2 parqueaderos y la propiedad tiene 1 -> no es candidata", () => {
  const m = evaluarCandidata(propiedad({ garaje: 1 }), { ...pedido, garajes: 2 }, "diamond");
  assert.strictEqual(m, null);
});

test("pide 2 parqueaderos y la propiedad tiene 2 -> pasa y lo dice", () => {
  const m = evaluarCandidata(propiedad({ garaje: 2 }), { ...pedido, garajes: 2 }, "diamond");
  assert.ok(m, "tiene que pasar");
  assert.ok(m.razones.some((r) => /2 garajes/.test(r)), `razones: ${m.razones.join(" | ")}`);
  assert.strictEqual(m.garajes_sin_dato, false);
});

test("pide 1 parqueadero y la propiedad tiene 3 -> pasa: de mas no incumple", () => {
  const m = evaluarCandidata(propiedad({ garaje: 3 }), { ...pedido, garajes: 1 }, "diamond");
  assert.ok(m, "tener de mas no puede descartar");
});

test("pide parqueadero y la ficha no trae el dato -> pasa marcada, no sale sola", () => {
  const m = evaluarCandidata(propiedad({ garaje: null }), { ...pedido, garajes: 2 }, "diamond");
  assert.ok(m, "sin dato no se descarta: la asesora tiene que poder verla");
  assert.strictEqual(m.garajes_sin_dato, true);
});

test("el pedido no menciona parqueadero -> el dato faltante no marca nada", () => {
  const m = evaluarCandidata(propiedad({ garaje: null }), pedido, "diamond");
  assert.ok(m);
  assert.strictEqual(m.garajes_sin_dato, false);
});

test("los baños NO se vuelven literales: quedarse corto sigue pasando con su castigo", () => {
  const m = evaluarCandidata(propiedad({ banos: 1 }), { ...pedido, banos: 2 }, "diamond");
  assert.ok(m, "baños es un numero: mantiene la gabela del 2026-09-04");
});
