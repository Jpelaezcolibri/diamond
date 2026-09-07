const { test } = require("node:test");
const assert = require("node:assert");
const { ESQUEMA } = require("../src/groups/classify");

const props = ESQUEMA.properties.mensajes.items.properties;
const required = ESQUEMA.properties.mensajes.items.required;

test("el esquema extrae amoblado como TRI-ESTADO, no booleano", () => {
  // Un booleano no distingue "no lo pidio" de "lo rechazo", y son conductas
  // opuestas. Caso real en la base: "*3 alcobas mas servicio* $9.000.000
  // *SIN muebles*" — ante "" la amoblada es elegible, ante "no" se descarta.
  assert.deepStrictEqual(props.amoblado.enum, ["si", "no", ""]);
  assert.ok(required.includes("amoblado"), "amoblado tiene que ser required");
});

test("el esquema extrae el periodo del arriendo", () => {
  // "$4.500.000 por 15 dias" calza perfecto contra nuestro amoblado mensual
  // y le ofreceriamos un mes por el precio de quince dias.
  assert.deepStrictEqual(props.periodo.enum, ["mes", "corta", ""]);
  assert.ok(required.includes("periodo"), "periodo tiene que ser required");
});

test("los campos opcionales siguen sin ser nullables", () => {
  // Misma regla que el resto del esquema: el string vacio significa "no
  // especificado", asi que match.js no necesita comprobaciones de null.
  assert.strictEqual(props.amoblado.type, "string");
  assert.strictEqual(props.periodo.type, "string");
});
