// La descripción de la ficha llega a Sofi (Juan, 2026-11-11: "pásale a Sofi
// la descripción"). Auditoría del 11-nov: la revalidación del radar no la
// recibía; 90 veces el DM dijo "no tengo confirmado X" cuando la descripción
// sí lo decía, y salieron fichas con un dato descalificador escrito ahí (la
// 9944723 dice "tercer piso por escalas" y se mandó a quien pidió ascensor).
const { test } = require("node:test");
const assert = require("node:assert");

const { descripcionPlana } = require("../src/lib/texto-ficha");
const match = require("../src/groups/match");
const { formatearCandidatas, SISTEMA } = require("../src/groups/revalidar");
const { buildSystemPrompt } = require("../src/agent/prompts");

const HTML = "<p>APARTAMENTO NUEVO PARA ESTRENAR EN SABANETA&nbsp;</p> <div>&nbsp;</div> <div>3 Habitaciones&nbsp;</div><div>Tercer piso por escalas</div><div>Porter&iacute;a 24 h, a&ntilde;o 2020 &amp; balc&oacute;n</div>";

test("descripcionPlana quita etiquetas y entidades y deja texto corrido", () => {
  const t = descripcionPlana(HTML);
  assert.doesNotMatch(t, /<|&nbsp;|&iacute;/);
  assert.match(t, /APARTAMENTO NUEVO PARA ESTRENAR EN SABANETA/);
  assert.match(t, /Tercer piso por escalas/);
  assert.match(t, /Portería 24 h, año 2020 & balcón/);
  assert.strictEqual(descripcionPlana(""), null);
  assert.strictEqual(descripcionPlana(null), null);
  const larga = descripcionPlana(`<p>${"palabra ".repeat(300)}</p>`, 100);
  assert.ok(larga.length <= 101, "se recorta");
  assert.match(larga, /…$/);
});

test("la candidata del motor trae la descripción limpia", () => {
  const p = { ref: "9944723", titulo: "APTO", tipo: "Apartamento", operacion: "Venta", zona: "Envigado", precio: "$400.000.000", descripcion: HTML };
  const c = match.evaluarCandidata(p, { operacion: "venta", tipo: "apartamento", zona: "Envigado", precio_max: 450000000 }, "diamond");
  assert.match(c.descripcion || "", /Tercer piso por escalas/);
  assert.doesNotMatch(c.descripcion || "", /<div>/);
});

test("la revalidación ve la descripción y sabe que cuenta como dato", () => {
  const texto = formatearCandidatas([{ ref: "9944723", titulo: "APTO", puntaje: 80, razones: [], descripcion: "Tercer piso por escalas", fuente: "diamond" }]);
  assert.match(texto, /descripcion de la ficha: Tercer piso por escalas/);
  assert.match(SISTEMA, /descripcion de la ficha/);
  assert.match(SISTEMA, /contradice/i);
});

test("el contexto del colega muestra la descripción de las fichas que le mandamos", () => {
  const texto = buildSystemPrompt({
    org: { id: "o", name: "Diamond" }, lead: { id: "l", phone: "573000000000" }, qualified: false,
    now: { legible: "martes", iso: "2026-11-11T10:00:00-05:00" }, colega: { nombre: "Ana" },
    fichasPedido: [{ ref: "9944723", tipo: "Apartamento", operacion: "Venta", zona: "Envigado", precio: "$400.000.000", descripcion: HTML }],
  }).map((b) => b.text).join("\n");
  assert.match(texto, /descripción: .*Tercer piso por escalas/);
  assert.doesNotMatch(texto, /<div>/);
});
