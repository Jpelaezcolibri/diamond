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

const { detectOwnerRentIntent } = require("../src/agent/intent");

const duenoArrienda = [
  "Hola, quiero arrendar mi apartamento con ustedes",
  "quiero poner en arriendo mi casa",
  "necesito arrendar mi apto de Envigado",
  "tengo un apartamento para arrendar",
  "tengo un apto para rentar en Sabaneta",
  "quiero rentar mi apto por noches",
  "quiero poner mi apto en Airbnb",
  "mi apartamento lo quiero arrendar",
  "ustedes administran arriendos?",
  "Hola, quiero poner en arriendo mi propiedad",
  "quiero alquilar mi apartamento",
  "quiero poner mi apto en arriendo",
  "tengo una casa para arriendo",
  "mi apto esta desocupado, como lo arriendo?",
];

const inquilino = [
  "busco arrendar un apartamento en Envigado",
  "quiero arrendar un apto en el poblado",
  "necesito un apartamento en arriendo",
  "tienen apartamentos para arrendar en Laureles?",
  "busco algo en renta corta para diciembre",
  "quiero vender mi apartamento",
  "me interesa la propiedad 10077063",
  "quiero arrendar mi primer apartamento",
  "busco arrendar mi primer apto",
  "estoy buscando para arrendar mi familia",
  "quiero arrendar mis vacaciones en un apto",
  "quiero rentar mi carro",
  "mi localidad favorita es Envigado, busco arrendar",
  "mi casa actual es pequena, busco arrendar un apto",
  "mi apartamento actual se vende, busco arrendar otro",
  "mi oficina queda lejos, necesito arrendar apto cerca",
  "mi apto queda en Envigado y quiero arrendar algo cerca",
  "quiero arrendar mi apartamento ideal en Laureles",
  "mi casa es pequena y quiero arrendar una mas grande",
  "mi oficina necesita arrendar un local",
  "busco arrendar mi apartamento ideal",
];

test("detecta al dueno que quiere arrendar su inmueble (mensual o renta corta)", () => {
  for (const t of duenoArrienda) {
    assert.strictEqual(detectOwnerRentIntent(t), "consignar_arriendo", `deberia detectar dueno en: "${t}"`);
  }
});

test("NO confunde a un inquilino ni a un vendedor con un dueno que arrienda", () => {
  for (const t of inquilino) {
    assert.strictEqual(detectOwnerRentIntent(t), null, `NO deberia detectar dueno en: "${t}"`);
  }
});

test("las frases de vender siguen dando vender y no consignar_arriendo", () => {
  assert.strictEqual(detectSellerIntent("quiero vender mi casa"), "vender");
  assert.strictEqual(detectOwnerRentIntent("quiero vender mi casa"), null);
});

const { intencionDeDuenoEnTurno } = require("../src/agent/intent");

test("intencionDeDuenoEnTurno: solo mira el mensaje actual y respeta los blindajes", () => {
  const dueno = "quiero arrendar mi apartamento";
  assert.strictEqual(intencionDeDuenoEnTurno({ text: dueno, lead: {} }), "consignar_arriendo");
  // Sofi corrigio a arrendar (inquilino) y el mensaje actual no lo repite: no vuelve a "dueno".
  assert.strictEqual(intencionDeDuenoEnTurno({ text: "gracias, y que opciones hay en Envigado?", lead: { intencion: "arrendar" } }), null);
  assert.strictEqual(intencionDeDuenoEnTurno({ text: dueno, lead: {}, advisor: { id: 1 } }), null);
  assert.strictEqual(intencionDeDuenoEnTurno({ text: dueno, lead: {}, colega: { id: 1 } }), null);
  assert.strictEqual(intencionDeDuenoEnTurno({ text: dueno, lead: { intencion: "vender" } }), null);
  assert.strictEqual(intencionDeDuenoEnTurno({ text: dueno, lead: { intencion: "consignar_arriendo" } }), null);
  assert.strictEqual(intencionDeDuenoEnTurno({ text: "quiero vender mi casa y arrendar mi apto", lead: {} }), null);
});
