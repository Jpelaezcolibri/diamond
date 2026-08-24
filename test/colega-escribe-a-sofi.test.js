// Un colega de otra inmobiliaria escribiendole a Sofi.
//
// Es el TERCER rol del mismo mecanismo que ya distingue al asesor de la casa
// (test/asesor-escribe-a-sofi.test.js), y existe por la misma razon: el
// 2026-07-29 Sofi trato a Natalia como clienta y le dejo un lead falso en el
// embudo. Un colega mal atendido es peor todavia — es un par con el que se
// comparte comision, y tratarlo como lead quema la relacion profesional.
//
// Juan, 2026-08-22: "que sofi lo atienda con tono para colega".

const { test } = require("node:test");
const assert = require("node:assert");
const { buildSystemPrompt } = require("../src/agent/prompts");

const org = { id: "org-1", name: "Diamond Inmobiliaria" };
const lead = { id: "l1", estado: "nuevo" };
const colega = { nombre: "Esteban Higuita" };
const asesora = { id: "a1", name: "Natalia Velez", especialidad: "venta" };

const texto = (bloques) => bloques.map((b) => b.text).join("\n");

test("con un colega, Sofi no arranca el discurso de calificacion", () => {
  const p = texto(buildSystemPrompt({ org, lead, qualified: false, now: null, colega }));
  assert.match(p, /NO es un cliente/);
  assert.match(p, /NUNCA le preguntes presupuesto/);
  assert.match(p, /NUNCA le ofrezcas "conectarlo con un asesor"/);
  assert.doesNotMatch(p, /ESTADO DE CALIFICACION/);
});

test("a diferencia del asesor de la casa, al colega SI se le ofrece inventario", () => {
  const p = texto(buildSystemPrompt({ org, lead, qualified: false, now: null, colega }));
  assert.match(p, /buscar_propiedades/);
  // La regla del asesor ("NUNCA le ofrezcas propiedades") no aplica aca: el
  // colega viene justamente a ver que tenemos.
  assert.doesNotMatch(p, /NUNCA le ofrezcas propiedades/);
});

test("el colega se nombra en el prompt", () => {
  const p = texto(buildSystemPrompt({ org, lead, qualified: false, now: null, colega }));
  assert.match(p, /Esteban Higuita/);
});

test("la comision se acuerda entre ellos: el sistema no reparte", () => {
  const p = texto(buildSystemPrompt({ org, lead, qualified: false, now: null, colega }));
  assert.match(p, /comisi/i);
});

test("un asesor de la casa gana sobre colega", () => {
  // Un asesor propio que ademas esta en un grupo gremial sigue siendo de la casa.
  const p = texto(buildSystemPrompt({ org, lead, qualified: false, now: null, advisor: asesora, colega }));
  assert.match(p, /Natalia Velez/);
  assert.doesNotMatch(p, /Esteban Higuita/);
});

test("sin colega ni asesor, el prompt de cliente queda intacto", () => {
  const p = texto(buildSystemPrompt({ org, lead, qualified: false, now: null }));
  assert.match(p, /ESTADO DE CALIFICACION/);
});

test("el prompt de colega se cachea igual que los otros", () => {
  // El bloque estable lleva cache_control: sin eso se paga el prompt entero en
  // cada turno.
  const bloques = buildSystemPrompt({ org, lead, qualified: false, now: null, colega });
  assert.ok(bloques.some((b) => b.cache_control), "el bloque estable tiene que ir cacheado");
});
