// Deteccion deterministica del idioma del cliente a partir de su PRIMER
// mensaje. La senal fuerte son NUESTROS prellenados de la landing en ingles
// (los conocemos exactos); la heuristica organica es conservadora: ante la
// duda, español (null).
const { test } = require("node:test");
const assert = require("node:assert");
const { detectClientLanguage } = require("../src/agent/intent");

test("prellenados EN de la landing detectan 'en'", () => {
  assert.strictEqual(detectClientLanguage("Hi, I'm interested in property 9702941"), "en");
  assert.strictEqual(detectClientLanguage("Hi, I'd like information about your properties"), "en");
  assert.strictEqual(detectClientLanguage("Hi, I want to sell my property with you"), "en");
});

test("prellenados ES actuales NO detectan ingles", () => {
  assert.strictEqual(detectClientLanguage("Hola, me interesa la propiedad 9702941"), null);
  assert.strictEqual(detectClientLanguage("Hola, quiero información sobre sus propiedades"), null);
  assert.strictEqual(detectClientLanguage("Hola, quiero vender mi propiedad con ustedes"), null);
});

test("ingles organico (sin prellenado) detecta 'en'", () => {
  assert.strictEqual(detectClientLanguage("Hello, I'm looking for an apartment for rent in El Poblado"), "en");
  assert.strictEqual(detectClientLanguage("Do you have houses for sale in Envigado?"), "en");
});

test("espanol organico devuelve null", () => {
  assert.strictEqual(detectClientLanguage("Buenas, busco apartamento en arriendo en Laureles"), null);
  assert.strictEqual(detectClientLanguage("¿Cuánto vale la casa de Envigado?"), null);
});

test("mensajes cortos o ambiguos devuelven null (conservador)", () => {
  assert.strictEqual(detectClientLanguage("ok"), null);
  assert.strictEqual(detectClientLanguage("hola"), null);
  assert.strictEqual(detectClientLanguage("9702941"), null);
  assert.strictEqual(detectClientLanguage(""), null);
  assert.strictEqual(detectClientLanguage(null), null);
});

test("mezcla con senales españolas gana el español", () => {
  assert.strictEqual(detectClientLanguage("Hola, do you have apartamentos en El Poblado?"), null);
});
