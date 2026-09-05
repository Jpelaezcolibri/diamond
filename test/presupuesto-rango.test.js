// El parser de presupuestos no puede inventar numeros.
//
// EL INCIDENTE (2026-09-05). Un lead de julio tenia guardado el presupuesto
// como texto libre: "500 a 600 millones". El parser le arrancaba todo lo que
// no fuera digito y pegaba lo que quedaba: "500600" -> por 1.000.000 ->
// $500.600.000.000. Medio billon de pesos. Ese lead le ganaba en presupuesto
// a CUALQUIER propiedad, asi que calzo con las 1.906 ofertas que pasaron por
// el radar entre el 1 y el 5 de septiembre, y cada una disparo un WhatsApp a
// la misma asesora.
//
// LA REGLA (Juan, 2026-09-05: "que no se envie informacion inventada"): un
// rango es un rango. El presupuesto de un cliente es un TECHO, asi que de
// "500 a 600 millones" lo que manda es 600 — nunca un numero que no dijo
// nadie.
const { test } = require("node:test");
const assert = require("node:assert");
const { parsePresupuesto } = require("../src/data/command");

const M = 1_000_000;

test("un rango se lee por su techo, no pegando los dos numeros", () => {
  assert.strictEqual(parsePresupuesto("500 a 600 millones"), 600 * M);
  assert.strictEqual(parsePresupuesto("entre 300 y 400 millones"), 400 * M);
  assert.strictEqual(parsePresupuesto("de 800 a 900 millones"), 900 * M);
  assert.strictEqual(parsePresupuesto("600-700 millones"), 700 * M);
});

test("el caso exacto que causo el incidente no vuelve a pasar", () => {
  const n = parsePresupuesto("500 a 600 millones");
  assert.ok(n < 1_000 * M, `leyo ${n}, un presupuesto imposible`);
  // Y deja de ganarle a una propiedad de $850M, que es lo que disparaba todo.
  assert.ok(n < 850 * M * 0.9, "sigue calzando con una propiedad de $850M");
});

test("lo que ya funcionaba sigue igual", () => {
  assert.strictEqual(parsePresupuesto("600 millones"), 600 * M);
  assert.strictEqual(parsePresupuesto("hasta 900 millones"), 900 * M);
  assert.strictEqual(parsePresupuesto("$850.000.000"), 850 * M);
  assert.strictEqual(parsePresupuesto("1.300 millones"), 1_300 * M);
  assert.strictEqual(parsePresupuesto("1300"), 1_300 * M);
  assert.strictEqual(parsePresupuesto("450000000"), 450 * M);
});

test("un separador de miles no se confunde con un rango", () => {
  // "2.500" es dos mil quinientos, no "2 a 500".
  assert.strictEqual(parsePresupuesto("2.500 millones"), 2_500 * M);
  assert.strictEqual(parsePresupuesto("de 2.000 a 2.500 millones"), 2_500 * M);
});

test("sin numero no inventa nada", () => {
  assert.strictEqual(parsePresupuesto(""), null);
  assert.strictEqual(parsePresupuesto(null), null);
  assert.strictEqual(parsePresupuesto("no sabe todavia"), null);
});

test("el valor de un cierre (misma funcion) tampoco se infla", () => {
  // command.camposDeCierre usa este parser para valor_cierre.
  assert.strictEqual(parsePresupuesto("340 millones"), 340 * M);
});
