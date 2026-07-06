const { test } = require("node:test");
const assert = require("node:assert");
const { matchesFilters } = require("../src/data/ally-properties");

const guatape = { zona: "Guatape", ciudad: "Antioquia", tipo: "Apartamento", operacion: "Venta", precio: "$450.000.000", estado: "pendiente" };
const laureles = { zona: "Laureles", ciudad: "Medellin", tipo: "Casa", operacion: "Arriendo", precio: "$2.500.000", estado: "confirmada" };

test("matchesFilters: coincide por zona con el mismo criterio distintivo que properties.js", () => {
  assert.strictEqual(matchesFilters(guatape, { zona: "Guatape" }), true);
  assert.strictEqual(matchesFilters(guatape, { zona: "Laureles" }), false);
});

test("matchesFilters: Venta y Arriendo nunca se mezclan", () => {
  assert.strictEqual(matchesFilters(guatape, { operacion: "Venta" }), true);
  assert.strictEqual(matchesFilters(guatape, { operacion: "Arriendo" }), false);
  assert.strictEqual(matchesFilters(laureles, { operacion: "Arriendo" }), true);
});

test("matchesFilters: tipo filtra sin distinguir mayusculas", () => {
  assert.strictEqual(matchesFilters(guatape, { tipo: "apartamento" }), true);
  assert.strictEqual(matchesFilters(guatape, { tipo: "Casa" }), false);
});

test("matchesFilters: precioMax descarta lo que se pasa del presupuesto", () => {
  assert.strictEqual(matchesFilters(guatape, { precioMax: 500000000 }), true);
  assert.strictEqual(matchesFilters(guatape, { precioMax: 400000000 }), false);
});

test("matchesFilters: sin filtros, todo coincide", () => {
  assert.strictEqual(matchesFilters(guatape, {}), true);
});

test("matchesFilters: propiedad sin zona/tipo no rompe (campos parciales de la extraccion)", () => {
  const parcial = { precio: "$300.000.000", estado: "pendiente" };
  assert.strictEqual(matchesFilters(parcial, { zona: "Guatape" }), false);
  assert.strictEqual(matchesFilters(parcial, {}), true);
});
