const { test } = require("node:test");
const assert = require("node:assert");
const { detectSellerIntent } = require("../src/agent/intent");

const vende = [
  "Hola, quiero vender mi propiedad con ustedes",
  "quiero vender mi apartamento",
  "en realidad yo quiero es vender mi casa",
  "necesito vender mi finca",
  "quisiera consignar mi inmueble con ustedes",
  "quiero poner en venta mi apartamento",
  "vendo mi lote en Envigado",
  "mi casa la quiero poner en venta",
];

const noVende = [
  "Hola, estoy interesado en esta propiedad",
  "quiero comprar un apartamento en el poblado",
  "busco casa en arriendo",
  "cuanto vale ese apartamento en venta?", // comprador preguntando por una venta
  "me interesa la propiedad AP001",
  "tienes algo en la loma del indio?",
  // Regresion: un colega compartiendo una propiedad de OTRA inmobiliaria no es
  // un propietario pidiendo consignar (ver reglas 37-40 de prompts.js).
  "les comparto esta propiedad que tengo en mi inmobiliaria",
  "miren este apartamento en venta, referencia 10128030 en Wasi",
  "Natalia Velez, Paraiso inmobiliaria — apartamento en venta en Guatape",
];

test("detecta intencion de vender en frases explicitas de propietario", () => {
  for (const t of vende) {
    assert.strictEqual(detectSellerIntent(t), "vender", `deberia detectar vender en: "${t}"`);
  }
});

test("NO confunde a un comprador con un vendedor", () => {
  for (const t of noVende) {
    assert.strictEqual(detectSellerIntent(t), null, `NO deberia detectar vender en: "${t}"`);
  }
});

test("tolera entradas vacias o nulas", () => {
  assert.strictEqual(detectSellerIntent(""), null);
  assert.strictEqual(detectSellerIntent(null), null);
  assert.strictEqual(detectSellerIntent(undefined), null);
});
