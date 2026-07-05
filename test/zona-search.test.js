const { test } = require("node:test");
const assert = require("node:assert");
const { matchesFilters, distinctiveTokens, zonaTokens } = require("../src/data/properties");

// Inventario minimo de referencia (zonas reales del catalogo Diamond).
const lomaChocho = { ref: "9702941", zona: "Loma del Chocho", ciudad: "Envigado", tipo: "Apartamento", habitaciones: 2, precio: "$720.000.000", disponible: true };
const poblado = { ref: "9856842", zona: "El poblado", ciudad: "Medellin", tipo: "Apartamento", habitaciones: 3, precio: "$900.000.000", disponible: true };
const castropol = { ref: "8989725", zona: "Castropol", ciudad: "Medellin", tipo: "Apartamento", habitaciones: 3, precio: "$920.000.000", disponible: true };

test("BUG: 'loma del indio' NO matchea 'Loma del Chocho' solo por la palabra 'loma'", () => {
  // Loma del Indio (El Poblado) esta lejos de Loma del Chocho (Envigado):
  // un match por la palabra generica "loma" ubicaba al cliente en el sitio equivocado.
  assert.strictEqual(matchesFilters(lomaChocho, { zona: "loma del indio" }), false);
});

test("'loma del chocho' SI matchea 'Loma del Chocho' (token distintivo: chocho)", () => {
  assert.strictEqual(matchesFilters(lomaChocho, { zona: "loma del chocho" }), true);
});

test("'el poblado' matchea propiedades del Poblado", () => {
  assert.strictEqual(matchesFilters(poblado, { zona: "el poblado" }), true);
});

test("'castropol' matchea Castropol pero no Loma del Chocho", () => {
  assert.strictEqual(matchesFilters(castropol, { zona: "castropol" }), true);
  assert.strictEqual(matchesFilters(lomaChocho, { zona: "castropol" }), false);
});

test("distinctiveTokens descarta genericas si hay una distintiva", () => {
  assert.deepStrictEqual(distinctiveTokens(zonaTokens("loma del indio")), ["indio"]);
  assert.deepStrictEqual(distinctiveTokens(zonaTokens("loma de los balsos")), ["balsos"]);
});

test("distinctiveTokens usa las genericas como ultimo recurso si no hay distintivas", () => {
  // Query solo con palabra generica: no se pierde del todo, se usa como fallback.
  assert.deepStrictEqual(distinctiveTokens(zonaTokens("la loma")), ["loma"]);
});

test("sin zona, matchesFilters no filtra por ubicacion", () => {
  assert.strictEqual(matchesFilters(lomaChocho, {}), true);
});
