const { test } = require("node:test");
const assert = require("node:assert");
const { textoExcel, resumenMotivos, cuantas } = require("../src/lib/texto-pendientes");

const caso = (motivo, nombre = "Clara", tipo = "colega") => ({ motivo, nombre, tipo });

test("cuántas: singular y plural bien", () => {
  assert.strictEqual(cuantas(1), "1 persona");
  assert.strictEqual(cuantas(3), "3 personas");
});

test("resumen por motivo, en orden de cantidad y en plural o singular", () => {
  assert.strictEqual(resumenMotivos([caso("no_contesto"), caso("pide_asesor"), caso("no_contesto")]), "2 no le contestaron a Sofi y 1 pidió hablar con un asesor");
  assert.strictEqual(resumenMotivos([caso("sin_seguimiento"), caso("sin_seguimiento")]), "2 no le contestaron a Sofi y ella ya no alcanza a escribirles");
  assert.strictEqual(resumenMotivos([caso("raro")]), "1 quedó por contactar");
});

test("una persona: nombre y motivo; varias: conteo; cliente sin nombre no queda vacío", () => {
  assert.match(textoExcel("Catherine", [caso("sin_seguimiento", "Andrea Strauch")]), /^Catherine, tienes 1 persona por contactar: Andrea Strauch \(colega\), que no le contestó a Sofi y ella ya no alcanza a escribirle\. Comunícate con esa persona/);
  assert.match(textoExcel("Daiana", [caso("no_contesto", "(sin nombre)", "cliente")]), /1 persona por contactar: un cliente sin nombre, que no le contestó a Sofi/);
  const t = textoExcel("Daiana", [caso("no_contesto"), caso("no_contesto"), caso("nota_de_voz")]);
  assert.match(t, /^Daiana, tienes 3 personas por contactar: 2 no le contestaron a Sofi y 1 mandó una nota de voz que Sofi no puede escuchar\. Comunícate con cada una/);
  assert.match(t, /llena la columna Resultado \(y fecha, hora y ref si agendaste visita\) y devuélveme el Excel por este chat\.$/);
});
