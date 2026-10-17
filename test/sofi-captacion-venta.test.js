// Caso Felipe (2026-10-17): respondio la plantilla con "Lo tengo a la venta"
// (apartamento en La America). Sofi pidio solo el nombre, transfirio y dijo
// "Él te va a contactar" — la asesora es Daiana. Juan: "ajustalo".
const { test } = require("node:test");
const assert = require("node:assert");
const { buildSystemPrompt } = require("../src/agent/prompts");

const texto = buildSystemPrompt({ org: { id: "o", name: "Diamond" }, lead: {}, qualified: false }).map((b) => b.text).join("\n");
const regla33 = texto.split("\n").find((l) => l.startsWith("33. "));

test("antes de transferir una captacion de venta, Sofi junta los datos clave del inmueble", () => {
  assert.match(regla33, /barrio|sector/i);
  assert.match(regla33, /área|area|metros/i);
  assert.match(regla33, /alcobas/i);
  assert.match(regla33, /precio/i);
  assert.match(regla33, /motivo/i); // los datos viajan en el motivo de la transferencia
});

test("nunca promete que la contacta 'él': habla de nuestra asesora", () => {
  assert.match(regla33, /nuestra asesora/i);
  assert.doesNotMatch(regla33, /\bel asesor de ventas lo contacta\b/i);
});
