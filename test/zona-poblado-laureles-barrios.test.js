// Barrios del Poblado y Laureles (Juan, 2026-10-20, rescate de pedidos sin DM).
// Un pedido de barrio contra una ficha registrada solo con la zona general
// gradua zona_general, no vecina (que nunca sale).
const { test } = require("node:test");
const assert = require("node:assert");
const match = require("../src/groups/match");
const zonas = require("../src/lib/zonas");

const pide = (zona) => ({ tipo: "apartamento", operacion: "venta", zona, zonas: [], ciudad: null, habitaciones: 3, precio_max: 900000000 });
const apto = (zona, ciudad = "Medellín") => ({
  ref: "1", titulo: "Vendo apartamento", tipo: "Apartamento", operacion: "Venta", precio: "$550.000.000",
  zona, ciudad, habitaciones: 3, banos: 2, garaje: 1, estrato: 5, area: "90 m²",
  link: "https://diamondinmobiliaria.com/propiedades/x-1",
});
const grado = (pedida, ficha) => match.evaluarCandidata(apto(ficha), pide(pedida), "diamond")?.ubicacion;

test("Conquistadores contra Laureles y Balsos contra El Poblado son zona_general", () => {
  assert.strictEqual(grado("Conquistadores", "Laureles"), "zona_general");
  assert.strictEqual(grado("Los Balsos", "El Poblado"), "zona_general");
  assert.strictEqual(grado("Castropol", "El Poblado"), "zona_general");
});

test("cada barrio nuevo conoce su zona madre", () => {
  for (const b of ["balsos", "lalinde", "castropol", "tesoro", "provenza", "aguacatala", "carlota"]) assert.deepStrictEqual(zonas.madresDe([b]), ["poblado"], b);
  for (const b of ["conquistadores", "teresita", "bolivariana", "castellana", "suramericana"]) assert.deepStrictEqual(zonas.madresDe([b]), ["laureles"], b);
});

test("los ambiguos NO quedaron como barrios", () => {
  for (const b of ["calera", "diamante", "almendros", "campestre", "colombia", "rio", "restrepo", "acacias", "florida"]) assert.deepStrictEqual(zonas.madresDe([b]), [], b);
});

test("lo realmente vecino sigue vecino (no sale como zona_general)", () => {
  assert.strictEqual(grado("Itagüí", "Sabaneta"), "vecina");
  assert.strictEqual(grado("El Poblado", "Envigado"), "vecina");
  assert.strictEqual(grado("Envigado", "El Poblado"), "vecina");
});
