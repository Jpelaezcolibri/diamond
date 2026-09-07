const { test } = require("node:test");
const assert = require("node:assert");
const { evaluarCandidata } = require("../src/groups/match");

// Base que pasa todas las compuertas que YA existen, para que cada test de
// abajo aisle una sola variable: la de amoblado.
// "Los Gonzáles" quedo registrada en src/lib/zonas.js (VECINDAD + SUBZONA_DE)
// el 2026-09-07: un pedido de "El Poblado" contra esta zona gradua 'exacta',
// asi que la compuerta de ubicacion la deja pasar con `ciudad: ""`, sin
// truco.
const pedido = {
  operacion: "arriendo", tipo: "apartamento", zona: "El Poblado", zonas: ["El Poblado"],
  zonas_excluidas: [], ciudad: "", precio_max: 8000000, precio_min: 0,
  habitaciones: 2, area_min: 0, banos: 0, garajes: 0, estrato: 0,
  amoblado: "", periodo: "",
};

const amoblada = {
  ref: "10319436", titulo: "Apartamento Amoblado en Arriendo en El Poblado - Los Gonzáles",
  tipo: "Apartamento", operacion: "Arriendo", precio: "$7.900.000", area: "90m2",
  habitaciones: 3, zona: "Los Gonzáles", ciudad: "Medellín", caracteristicas: "Balcón, Ascensor",
};

const vacia = {
  ref: "99999", titulo: "Apartamento sin amoblar en El Poblado",
  tipo: "Apartamento", operacion: "Arriendo", precio: "$7.900.000", area: "90m2",
  habitaciones: 3, zona: "Los Gonzáles", ciudad: "Medellín", caracteristicas: "",
};

const desconocida = {
  ref: "88888", titulo: "Apartamento en El Poblado - Los Gonzáles",
  tipo: "Apartamento", operacion: "Arriendo", precio: "$7.900.000", area: "90m2",
  habitaciones: 3, zona: "Los Gonzáles", ciudad: "Medellín", caracteristicas: "Balcón",
};

test("pide amoblado + ES amoblada -> pasa, suma y lo dice", () => {
  const m = evaluarCandidata(amoblada, { ...pedido, amoblado: "si" }, "diamond");
  assert.ok(m, "tiene que pasar la compuerta");
  assert.strictEqual(m.amoblado, true);
  assert.strictEqual(m.amoblado_sin_confirmar, false);
  assert.ok(m.razones.includes("amoblada"), `razones: ${m.razones.join("; ")}`);
});

test("pide amoblado + NO amoblada -> descarta", () => {
  assert.strictEqual(evaluarCandidata(vacia, { ...pedido, amoblado: "si" }, "diamond"), null);
});

test("pide amoblado + no sabemos -> pasa marcada sin confirmar", () => {
  // No se descarta: el pedido tiene que llegar igual a la asesora. Lo que
  // impide que salga sola es la marca, no la compuerta.
  const m = evaluarCandidata(desconocida, { ...pedido, amoblado: "si" }, "diamond");
  assert.ok(m, "no se descarta, se marca");
  assert.strictEqual(m.amoblado, null);
  assert.strictEqual(m.amoblado_sin_confirmar, true);
});

test("BUG: pide SIN muebles + ES amoblada -> descarta", () => {
  // Caso real en produccion (2026-09-07): "*Busco CASA para arriendo en el
  // Poblado* 3 alcobas mas servicio $9.000.000 *SIN muebles*". Antes de esto,
  // ese pedido cruzaba contra nuestro amoblado de Los Gonzales sin freno.
  assert.strictEqual(evaluarCandidata(amoblada, { ...pedido, amoblado: "no" }, "diamond"), null);
});

test("no lo menciona -> neutro, ni suma ni descarta", () => {
  const m = evaluarCandidata(amoblada, pedido, "diamond");
  assert.ok(m);
  assert.strictEqual(m.amoblado_sin_confirmar, false);
  assert.ok(!m.razones.includes("amoblada"), "no se declara lo que no se pidio");
});

test("BUG: '$4.500.000 por 15 dias' se marca como periodo no soportado", () => {
  // El precio calza perfecto contra un amoblado mensual del mismo valor y le
  // ofreceriamos un mes por el precio de quince dias.
  const m = evaluarCandidata(amoblada, { ...pedido, periodo: "corta" }, "diamond");
  assert.ok(m, "sigue siendo un match, la compuerta esta en publicable");
  assert.strictEqual(m.periodo_no_soportado, true);
});

test("periodo mensual o sin dato no marca nada", () => {
  assert.strictEqual(evaluarCandidata(amoblada, { ...pedido, periodo: "mes" }, "diamond").periodo_no_soportado, false);
  assert.strictEqual(evaluarCandidata(amoblada, pedido, "diamond").periodo_no_soportado, false);
});
