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
