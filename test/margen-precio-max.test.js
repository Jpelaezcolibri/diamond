// Juan, 2026-10-17: "déjalo en 3% cuando diga MAX". Caso: "presupuesto MAX
// $450millones" recibio la 10077063 a $490M (9 % encima, dentro del margen
// general del 10 %). Cuando el colega marca el precio como MAXIMO, el margen
// baja a 3 %; en el resto sigue el 10 %.

const { test } = require("node:test");
const assert = require("node:assert");
const { evaluarCandidata, presupuestoEsTope, margenPrecioDe, MARGEN_PRECIO } = require("../src/groups/match");

test("reconoce un presupuesto marcado como maximo (frases reales)", () => {
  assert.strictEqual(presupuestoEsTope("3 habitaciones - 70m2 min (Piso 8 max ) presupuesto MAX $450millones"), true);
  assert.strictEqual(presupuestoEsTope("parqueadero priv presupuesto max $520mm"), true);
  assert.strictEqual(presupuestoEsTope("*💲💲 Presupuesto máximo: $550.000.000*"), true);
  assert.strictEqual(presupuestoEsTope("2 ALCOBAS + ESTUDIO *MÁXIMO : $750 MILLONES* ASCENSOR"), true);
  assert.strictEqual(presupuestoEsTope("tope 600 millones, contado"), true);
  assert.strictEqual(presupuestoEsTope("hasta $480 millones MAX"), true);
});

test("un MAX que habla del piso, del area o de alcobas no cuenta", () => {
  assert.strictEqual(presupuestoEsTope("3 hab min - 70m2 min Max piso 10 - parqueadero priv presupuesto $520mm"), false);
  assert.strictEqual(presupuestoEsTope("máximo piso 7, presupuesto 500 millones"), false);
  assert.strictEqual(presupuestoEsTope("120 m2 máximo, 3 alcobas, $600 millones"), false);
  assert.strictEqual(presupuestoEsTope("Presupuesto: $480 millones, pago de contado"), false);
  assert.strictEqual(presupuestoEsTope("hasta $4mm"), false);
});

test("el margen es 3 % con MAX y el general sin MAX", () => {
  assert.strictEqual(margenPrecioDe({ texto_original: "presupuesto MAX $450millones" }), 0.03);
  assert.strictEqual(margenPrecioDe({ mensaje: { texto: "presupuesto MAX $450millones" } }), 0.03);
  assert.strictEqual(margenPrecioDe({ texto_original: "presupuesto $450 millones" }), MARGEN_PRECIO);
  assert.strictEqual(margenPrecioDe({}), MARGEN_PRECIO);
});

const pide = (texto) => ({
  operacion: "venta", tipo: "apartamento", zona: "Envigado", precio_min: 0, precio_max: 450000000,
  habitaciones: 3, area_min: 0, banos: 0, garajes: 0, estrato: 0, texto_original: texto,
});
const apto = (precio) => ({
  ref: "10077063", titulo: "Apartamento Envigado", tipo: "Apartamento", operacion: "Venta", precio,
  zona: "Envigado", ciudad: "Envigado", habitaciones: 3, banos: 2, garaje: 1, area: "83 m²", descripcion: "",
  link: "https://diamondinmobiliaria.com/propiedades/x-10077063",
});

test("CASO REAL: con 'presupuesto MAX $450millones', la de $490M ya no entra", () => {
  assert.strictEqual(evaluarCandidata(apto("$490.000.000"), pide("presupuesto MAX $450millones"), "diamond"), null);
});

test("con MAX, hasta 3 % encima sigue entrando ($463M sobre $450M)", () => {
  assert.ok(evaluarCandidata(apto("$463.000.000"), pide("presupuesto MAX $450millones"), "diamond"));
});

test("sin MAX el margen general no cambia: $490M sobre $450M sigue entrando", () => {
  assert.ok(evaluarCandidata(apto("$490.000.000"), pide("presupuesto $450 millones"), "diamond"));
});
