// Sofi con el colega en rol de vendedora senior (Juan, 2026-10-07): resuelve
// dudas, ofrece similares, no repite lo ya enviado y cierra con UNA pregunta
// de avance.
const { test } = require("node:test");
const assert = require("node:assert");
const { buildSystemPrompt } = require("../src/agent/prompts");

const estable = buildSystemPrompt({
  org: { id: "org-1", name: "Diamond" },
  lead: { id: "l1", estado: "nuevo" },
  qualified: false,
  now: null,
  colega: { nombre: "Laura" },
})[0].text;

test("el prompt de colega es de vendedora senior", () => {
  assert.match(estable, /vendedora senior/);
  assert.match(estable, /UNA pregunta de avance/);
  assert.match(estable, /SIMILARES con buscar_propiedades/);
  assert.match(estable, /LO QUE YA HABLAMOS/);
  assert.match(estable, /link de agendar visita/);
});

test("se fueron las reglas que lo frenaban", () => {
  assert.doesNotMatch(estable, /sin discurso de ventas/);
  assert.doesNotMatch(estable, /No le cierres cada mensaje con una pregunta comercial/);
});
