// El pedido dice el piso en uno de cada cuatro casos: 255 de los 1.000
// pedidos capturados entre el 1-ago y el 18-sep lo nombran ("Sólo hasta 3°
// piso", "Sin ascensor máximo segundo", "Nivel de piso máximo 7", "ojalá piso
// 1"). Hasta el 2026-09-18 el clasificador no lo extraia, asi que el motor no
// podia respetarlo ni aunque la ficha lo dijera.

const { test } = require("node:test");
const assert = require("node:assert");
const { ESQUEMA } = require("../src/groups/classify");

const props = ESQUEMA.properties.mensajes.items.properties;
const required = ESQUEMA.properties.mensajes.items.required;

test("el esquema extrae el techo de piso del pedido", () => {
  assert.strictEqual(props.piso_max.type, "integer");
  assert.ok(required.includes("piso_max"), "piso_max tiene que ser required");
});

test("el esquema extrae el piso minimo del pedido", () => {
  assert.strictEqual(props.piso_min.type, "integer");
  assert.ok(required.includes("piso_min"), "piso_min tiene que ser required");
});

test("0 es 'no lo pidio', igual que el resto de los numeros del esquema", () => {
  // Mismo criterio que banos/garajes/estrato: el esquema no usa null, usa el
  // cero. Un null obligaria a comprobarlo en cada lector.
  assert.match(props.piso_max.description, /\b0\b/);
  assert.match(props.piso_min.description, /\b0\b/);
});

test("el prompt le enseña las tres formas reales de pedir piso", () => {
  // No es un test de redaccion: si el prompt no nombra estos tres casos, el
  // modelo devuelve 0 y la compuerta nueva no se entera de nada. Son las
  // formas que aparecen en los pedidos reales.
  const { SISTEMA: PROMPT_SISTEMA } = require("../src/groups/classify");
  assert.match(PROMPT_SISTEMA, /piso_max/, "el prompt tiene que nombrar el campo");
  assert.match(PROMPT_SISTEMA, /ascensor/i, "'sin ascensor maximo segundo' es un techo de piso");
  assert.match(PROMPT_SISTEMA, /piso alto/i, "'piso alto' es un piso minimo");
});

// EL PISO CASI NUNCA ES UN NUMERO EXACTO (medido sobre las 227 menciones de
// "piso" en los pedidos del 1-ago al 18-sep): 140 son un techo, 62 un piso
// minimo y 3 un rango. Juan, 2026-09-18: "cuando mencionan mas de o menos de
// tal piso (...) que no se haga literal, que si dice un piso menos a 10 no
// deje de mostrar un piso nueve porque cree que tiene que ser piso 10".
//
// El riesgo es la regla contraria a la de la zona: aca el daño es pasarse de
// estricto y borrar propiedades que el colega SI aceptaria.
test("el prompt enseña que 'menos de' y 'hasta' son un techo, no un piso exacto", () => {
  const { SISTEMA } = require("../src/groups/classify");
  assert.match(SISTEMA, /menos de/i, "'menos del piso 10' es piso_max 10, no piso exacto");
  assert.match(SISTEMA, /en adelante|hacia arriba|para arriba/i, "'piso 5 en adelante' es piso_min 5");
});

test("el prompt enseña los rangos: 'piso 2 al 11', 'del 4 al 8', 'piso 1 o 2'", () => {
  const { SISTEMA } = require("../src/groups/classify");
  assert.match(SISTEMA, /\bal\b.{0,40}piso|piso.{0,40}\bal\b/i, "un rango llena los DOS campos");
});

test("el prompt enseña que 'ojalá piso 1' es un deseo y no una exigencia", () => {
  const { SISTEMA } = require("../src/groups/classify");
  assert.match(SISTEMA, /ojal[aá]/i);
});

test("el prompt distingue las PLANTAS de una casa del nivel de un edificio", () => {
  // "Máximo 2 pisos" en un pedido de casa son plantas. Leerlo como techo de
  // piso deja el pedido sin una sola propiedad.
  const { SISTEMA } = require("../src/groups/classify");
  assert.match(SISTEMA, /plantas?/i);
});
