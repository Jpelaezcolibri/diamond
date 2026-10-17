// Caso Juanita Monsalve (colega, 2026-10-17): mando una nota de voz y Sofi
// le dijo "Lamento que no hayas podido escuchar el audio que te envié" (lo
// invirtio: el audio era de ella). Ademas describio la 9944723 con los datos
// del PEDIDO ("3 habitaciones, 120 m², sector tranquilo") y no con los de la
// ficha (4 alcobas, 141 m²; lo del sector no estaba confirmado), y la paso a
// "nuestro asesor" cuando es Daiana. Reglas para los dos prompts.
const { test } = require("node:test");
const assert = require("node:assert");
const { buildSystemPrompt } = require("../src/agent/prompts");

const org = { id: "o", name: "Diamond" };
const textos = {
  cliente: buildSystemPrompt({ org, lead: {}, qualified: false }).map((b) => b.text).join("\n"),
  colega: buildSystemPrompt({ org, lead: {}, qualified: false, colega: { nombre: "Juanita", lid: "1" } }).map((b) => b.text).join("\n"),
};

for (const [quien, t] of Object.entries(textos)) {
  test(`${quien}: una nota de voz es de la persona y Sofi no la puede escuchar`, () => {
    assert.match(t, /\[Nota de voz recibida\]/);
    assert.match(t, /no puedes escuchar/i);
  });
  test(`${quien}: una propiedad se describe solo con los datos de la ficha`, () => {
    assert.match(t, /nunca la describas con los datos del pedido/i);
  });
  test(`${quien}: la asesora es "nuestra asesora"`, () => {
    assert.match(t, /nuestra asesora/i);
  });
}
