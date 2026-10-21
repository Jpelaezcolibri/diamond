const { test } = require("node:test");
const assert = require("node:assert");
const { evaluarCandidata, filtrosInventario } = require("../src/groups/match");

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

test("pedido apartamento calza con Dúplex, Penthouse y Loft", () => {
  for (const tipo of ["Dúplex", "Duplex", "Penthouse", "Pent House", "Loft"]) {
    assert.ok(evaluarCandidata(prop({ tipo, titulo: "x" }), pide(), "diamond"), tipo);
  }
});

test("pedido apartamento NO trae apartaestudio y viceversa", () => {
  assert.equal(evaluarCandidata(prop({ tipo: "Apartaestudio" }), pide(), "diamond"), null);
  assert.equal(evaluarCandidata(prop({ tipo: "Apartamento" }), pide({ tipo: "apartaestudio" }), "diamond"), null);
});

test("pedido penthouse no trae un apartamento, salvo que el titulo lo diga", () => {
  assert.equal(evaluarCandidata(prop(), pide({ tipo: "penthouse" }), "diamond"), null);
  assert.ok(evaluarCandidata(prop({ titulo: "Penthouse en Laureles" }), pide({ tipo: "penthouse" }), "diamond"));
  assert.ok(evaluarCandidata(prop({ tipo: "Penthouse" }), pide({ tipo: "penthouse" }), "diamond"));
});

test("pedido casa sigue igual con casa campestre", () => {
  assert.ok(evaluarCandidata(prop({ tipo: "Casa Campestre" }), pide({ tipo: "casa" }), "diamond"));
});

test("el prefiltro de la base manda la lista de tipos aceptados", () => {
  const f = filtrosInventario(pide());
  assert.deepEqual(f.tipo, ["apartamento", "duplex", "dúplex", "penthouse", "pent house", "loft"]);
  assert.equal(f.tipoEnTitulo, undefined);
  assert.equal(filtrosInventario(pide({ tipo: "casa" })).tipo, "casa");
});

test("un pedido de penthouse tambien mira el titulo en el prefiltro", () => {
  const f = filtrosInventario(pide({ tipo: "penthouse" }));
  assert.deepEqual(f.tipo, ["penthouse"]);
  assert.equal(f.tipoEnTitulo, true);
  assert.deepEqual(filtrosInventario(pide({ tipo: "duplex" })).tipo, ["duplex", "dúplex"]);
});

test("el prefiltro en memoria deja pasar Dúplex y descarta casas", () => {
  const { matchesFilters } = require("../src/data/properties");
  const f = filtrosInventario(pide());
  assert.ok(matchesFilters({ ref: "1", zona: "Laureles", ciudad: "Medellin", operacion: "venta", habitaciones: 3, tipo: "Dúplex", precio: "100" }, f));
  assert.ok(matchesFilters({ ref: "2", zona: "Laureles", ciudad: "Medellin", operacion: "venta", habitaciones: 3, tipo: "Penthouse", precio: "100" }, f));
  assert.ok(!matchesFilters({ ref: "3", zona: "Laureles", ciudad: "Medellin", operacion: "venta", habitaciones: 3, tipo: "Casa", precio: "100" }, f));
  const fp = filtrosInventario(pide({ tipo: "penthouse" }));
  assert.ok(matchesFilters({ ref: "4", zona: "Laureles", ciudad: "Medellin", operacion: "venta", habitaciones: 3, tipo: "Apartamento", titulo: "Penthouse vista", precio: "100" }, fp));
});

test("tipoOr arma solo terminos seguros", () => {
  const { tipoOr } = require("../src/lib/tipos-filtro");
  assert.equal(tipoOr({ tipo: ["duplex", "dúplex"] }), "tipo.ilike.%duplex%,tipo.ilike.%dúplex%");
  assert.equal(tipoOr({ tipo: ["loft", "a,b)"], tipoEnTitulo: true }), "tipo.ilike.%loft%,titulo.ilike.%loft%");
});
