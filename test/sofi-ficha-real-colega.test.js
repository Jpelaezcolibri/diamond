// Caso Laura V. (2026-10-20): llego con el codigo 888P de su pedido ("La
// Estrella, Itagui, Sabaneta, hasta $350 millones") y Sofi le describio la
// 10505674 como "La Estrella, $349.900.000, 70 m²" con el link inventado
// diamondinmobiliaria.co/ficha/10505674. La ficha real: Sabaneta,
// $315.000.000, 55 m². Sofi tenia el texto del pedido y solo el numero de la
// ref; ahora recibe la ficha real y un link que no salio de ninguna fuente
// no llega al chat.
const { test } = require("node:test");
const assert = require("node:assert");
const { buildSystemPrompt } = require("../src/agent/prompts");
const { quitarLinksInventados } = require("../src/agent/links-verificados");

const ficha = {
  ref: "10505674", tipo: "Apartamento", operacion: "Venta", zona: "Sabaneta", ciudad: "Medellín",
  precio: "$315.000.000", area: "55m2", habitaciones: 3, banos: 2, garaje: 1, estrato: 4, disponible: true,
  linkWasi: "https://info.wasi.co/apartamento-venta-sabaneta-medellin/10505674?shared=whatsapp",
  link: "https://diamondinmobiliaria.com/propiedades/apartamento-10505674",
};

function contexto(fichasPedido) {
  return buildSystemPrompt({
    org: { id: "org-1", name: "Diamond" }, lead: { id: "l1", estado: "nuevo" }, qualified: false, now: null,
    colega: { nombre: "Laura V." },
    ultimoPedido: { texto_original: "BUSCO APARTAMENTO La Estrella, Itagüí, Sabaneta. Presupuesto máximo: $350 millones", respuesta_refs: ["10505674"] },
    fichasPedido,
  })[1].text;
}

test("el contexto del colega trae la ficha real de las refs que le mandamos", () => {
  const c = contexto([ficha]);
  assert.match(c, /10505674/);
  assert.match(c, /Sabaneta/);
  assert.match(c, /\$315\.000\.000/);
  assert.match(c, /55m2/);
  assert.match(c, /3 alcobas/);
  assert.match(c, /info\.wasi\.co\/apartamento-venta-sabaneta-medellin\/10505674/);
  assert.match(c, /NO son los del pedido/);
});

test("al colega se le da el link de Wasi, nunca el de la landing", () => {
  const c = contexto([ficha]);
  assert.doesNotMatch(c, /diamondinmobiliaria\.com\/propiedades/);
});

test("una ref que ya no esta disponible se dice", () => {
  assert.match(contexto([{ ...ficha, disponible: false }]), /YA NO ESTA DISPONIBLE/);
});

test("sin fichas, el contexto sigue como antes", () => {
  assert.doesNotMatch(contexto([]), /DATOS REALES/);
});

test("el prompt de colega dice que link dar", () => {
  const estable = buildSystemPrompt({
    org: { id: "org-1", name: "Diamond" }, lead: { id: "l1", estado: "nuevo" }, qualified: false, now: null, colega: { nombre: "Laura" },
  })[0].text;
  assert.match(estable, /linkWasi/);
  assert.match(estable, /Nunca armes un link/);
});

test("un link inventado no llega al chat", () => {
  const r = quitarLinksInventados(
    "Te comparto la ficha:\n**Link de la ficha:** https://www.diamondinmobiliaria.co/ficha/10505674\nCualquier duda me avisas.",
    ["datos sin links"]
  );
  assert.doesNotMatch(r.texto, /diamondinmobiliaria\.co/);
  assert.deepStrictEqual(r.quitados, ["https://www.diamondinmobiliaria.co/ficha/10505674"]);
  assert.match(r.texto, /Cualquier duda me avisas/);
});

test("un link que vino de una fuente pasa intacto, aunque lleve puntuacion detras", () => {
  const link = "https://info.wasi.co/apartamento-venta-sabaneta-medellin/10505674?shared=whatsapp";
  const r = quitarLinksInventados(`Aquí está: ${link}.`, [`{"linkWasi":"${link}"}`]);
  assert.strictEqual(r.texto, `Aquí está: ${link}.`);
  assert.deepStrictEqual(r.quitados, []);
});

test("un link escapado en el JSON de la herramienta cuenta como fuente", () => {
  const link = "https://info.wasi.co/casa-venta-envigado/9944723?shared=whatsapp";
  const r = quitarLinksInventados(`Mírala: ${link}`, [JSON.stringify({ linkWasi: link }).replace(/\//g, "\/")]);
  assert.deepStrictEqual(r.quitados, []);
});

test("si se quita el unico link, la linea queda limpia", () => {
  const r = quitarLinksInventados("Link de la ficha: https://falso.co/x\nOtra línea", []);
  assert.doesNotMatch(r.texto, /Link de la ficha:\s*$/m);
  assert.match(r.texto, /te confirmo el link/);
});
