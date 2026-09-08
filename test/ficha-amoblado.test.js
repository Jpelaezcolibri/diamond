const { test } = require("node:test");
const assert = require("node:assert");
const { ficha } = require("../src/groups/redactar");

const amoblada = {
  ref: "10319436", titulo: "Apartamento Amoblado en Arriendo en El Poblado - Los Gonzáles",
  operacion: "Arriendo", zona: "Los Gonzáles", precio: "$7.900.000", area: "90m2",
  habitaciones: 3, banos: null, garajes: null, estrato: null,
  linkWasi: "https://info.wasi.co/apartamento-alquiler-los-gonzales-medellin/10319436",
  amoblado: true,
};

test("la ficha del colega dice que esta amoblada", () => {
  const t = ficha(amoblada, 1);
  assert.ok(t.includes("amoblada"), `la ficha no lo declara:\n${t}`);
});

test("una propiedad de la que no sabemos NO se declara amoblada", () => {
  // La ausencia de dato nunca se convierte en una afirmacion. Es la misma
  // regla que ya rige banos/garajes/estrato: un hueco de sync no se disfraza.
  const t = ficha({ ...amoblada, amoblado: null }, 1);
  assert.ok(!t.includes("amoblada"), `afirmo lo que no sabe:\n${t}`);
});
