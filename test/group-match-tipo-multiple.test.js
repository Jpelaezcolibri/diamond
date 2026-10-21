const { test } = require("node:test");
const assert = require("node:assert");
const { evaluarCandidata, filtrosInventario, filtrosAliados, tiposPedidos } = require("../src/groups/match");

// BUG real (hallado 2026-09-11, arreglado 2026-10-16). El clasificador guarda
// varios tipos en un solo string ("apartamento, casa", "lote, casa") y el
// motor hacia un includes del string entero: ninguna propiedad lo contiene.
// Medido en 14 dias: 27 de 27 pedidos con varios tipos salieron sin match,
// contra 47 % de los de tipo simple. Caso: "lote, casa" en La Ceja con dos
// candidatas disponibles (casa 9548121, lote 9563362) y no salio ninguna.

const pide = (extra = {}) => ({
  operacion: "venta", tipo: "apartamento", zona: "Laureles",
  precio_min: 0, precio_max: 600000000, habitaciones: 3,
  area_min: 0, banos: 0, garajes: 0, estrato: 0, ...extra,
});

const prop = (extra = {}) => ({
  ref: "9944723", titulo: "Apartamento en Laureles", tipo: "Apartamento",
  operacion: "Venta", precio: "$550.000.000", zona: "Laureles", ciudad: "Medellín",
  habitaciones: 3, banos: 2, garaje: 1, estrato: 5, area: "95 m²",
  link: "https://diamondinmobiliaria.com/propiedades/apto-9944723", ...extra,
});

test("tiposPedidos parte por coma, barra, 'o' e 'y'", () => {
  assert.deepStrictEqual(tiposPedidos({ tipo: "apartamento, casa" }), ["apartamento", "casa"]);
  assert.deepStrictEqual(tiposPedidos({ tipo: "local,apartamento" }), ["local", "apartamento"]);
  assert.deepStrictEqual(tiposPedidos({ tipo: "Casa / Lote" }), ["casa", "lote"]);
  assert.deepStrictEqual(tiposPedidos({ tipo: "casa o finca" }), ["casa", "finca"]);
  assert.deepStrictEqual(tiposPedidos({ tipo: "casa y lote" }), ["casa", "lote"]);
  assert.deepStrictEqual(tiposPedidos({ tipo: "apartamento" }), ["apartamento"]);
  assert.deepStrictEqual(tiposPedidos({ tipo: "" }), []);
  assert.deepStrictEqual(tiposPedidos({}), []);
});

test("BUG: un pedido de 'apartamento, casa' acepta un apartamento", () => {
  assert.ok(evaluarCandidata(prop(), pide({ tipo: "apartamento, casa" }), "diamond"));
});

test("BUG: un pedido de 'apartamento, casa' acepta una casa", () => {
  const casa = prop({ tipo: "Casa", titulo: "Casa en Laureles" });
  assert.ok(evaluarCandidata(casa, pide({ tipo: "apartamento, casa" }), "diamond"));
});

test("un pedido de varios tipos sigue rechazando un tipo que no pidio", () => {
  const local = prop({ tipo: "Local", titulo: "Local en Laureles" });
  assert.strictEqual(evaluarCandidata(local, pide({ tipo: "apartamento, casa" }), "diamond"), null);
});

test("el tipo simple no cambia: casa no entra en un pedido de apartamento", () => {
  const casa = prop({ tipo: "Casa", titulo: "Casa en Laureles" });
  assert.strictEqual(evaluarCandidata(casa, pide(), "diamond"), null);
  assert.ok(evaluarCandidata(prop(), pide(), "diamond"));
});

test("prefiltro: con un solo tipo se manda igual que antes", () => {
  // (apartamento ya no viaja: tiene variantes, ver group-match-tipo-variantes)
  assert.strictEqual(filtrosInventario(pide({ tipo: "casa" })).tipo, "casa");
  assert.strictEqual(filtrosAliados(pide({ tipo: "casa" })).tipo, "casa");
});

test("BUG: prefiltro: con varios tipos NO se manda el string entero a la consulta", () => {
  // La consulta hace ilike '%apartamento, casa%' y no trae nada; la compuerta
  // de tipo la aplica evaluarCandidata con la lista partida.
  assert.strictEqual(filtrosInventario(pide({ tipo: "apartamento, casa" })).tipo, undefined);
  assert.strictEqual(filtrosAliados(pide({ tipo: "lote, casa" })).tipo, undefined);
});
