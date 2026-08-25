// test/group-cruce-mandatos.test.js
//
// El piso del filtro. Decision de producto de Juan (2026-08-25): filo bajo,
// salvedades escritas — Natalia decide que sirve, el sistema no descarta por
// ella. Pero un aviso que aprende a ignorar es peor que no mandarlo, y de eso
// se ocupan los tres cortes duros de aca: operacion, zona y precio.
const { test } = require("node:test");
const assert = require("node:assert");
const { evaluarOferta, criterioDeMandato } = require("../src/groups/cruce-mandatos");

const MANDATO = {
  id: "m-2",
  cliente_nombre: "Marcela Restrepo",
  operacion: "venta",
  tipo: "apartamento",
  zonas: ["El Poblado"],
  zonas_excluidas: [],
  precio_max: 2200000000,
  habitaciones: 4,
  flexible_habitaciones: false,
  area_min: 150,
  exigencias: ["balcón", "vista", "moderna"],
};

// Shape de una oferta ya normalizada a ally_properties (ver ofertas.js).
const OFERTA = {
  tipo: "Apartamento",
  operacion: "Venta",
  zona: "El Poblado",
  precio: "$1.580.000.000",
  habitaciones: 4,
  area: 246,
};

test("una oferta de arriendo NO sirve para un mandato de compra", () => {
  const r = evaluarOferta({ ...OFERTA, operacion: "Arriendo" }, MANDATO);
  assert.strictEqual(r, null, "cruzar operaciones distintas es el error mas caro: rompe la confianza en el aviso");
});

test("una oferta fuera de la zona pedida y sin vecindad NO sirve", () => {
  const r = evaluarOferta({ ...OFERTA, zona: "Bello" }, MANDATO);
  assert.strictEqual(r, null);
});

test("una oferta 14% arriba del tope SI sirve, con la salvedad escrita", () => {
  const r = evaluarOferta({ ...OFERTA, precio: "$2.508.000.000" }, MANDATO);
  assert.ok(r, "14% esta dentro del margen del 15%");
  assert.ok(r.salvedades.some((s) => /precio|tope/i.test(s)), `las salvedades deben nombrar el precio: ${JSON.stringify(r.salvedades)}`);
});

test("una oferta 20% arriba del tope NO sirve", () => {
  const r = evaluarOferta({ ...OFERTA, precio: "$2.640.000.000" }, MANDATO);
  assert.strictEqual(r, null);
});

test("cumple todo: sin salvedades de habitaciones ni area", () => {
  const r = evaluarOferta(OFERTA, MANDATO);
  assert.ok(r.sirve);
  assert.ok(r.cumple.length > 0, "debe decir que cumple");
  assert.ok(!r.salvedades.some((s) => /habitacion|alcoba/i.test(s)));
  assert.ok(!r.salvedades.some((s) => /m²|area/i.test(s)));
});

test("le falta area: sirve, y la salvedad dice cuanto le falta", () => {
  const r = evaluarOferta({ ...OFERTA, area: 145 }, MANDATO);
  assert.ok(r.sirve, "quedarse corto en area no descalifica — lo decide el asesor");
  assert.ok(
    r.salvedades.some((s) => s.includes("145") && s.includes("150")),
    `la salvedad debe ser accionable, no un puntaje: ${JSON.stringify(r.salvedades)}`
  );
});

test("le falta una habitacion: sirve, con la salvedad", () => {
  const r = evaluarOferta({ ...OFERTA, habitaciones: 3 }, MANDATO);
  assert.ok(r.sirve);
  assert.ok(r.salvedades.some((s) => /3 de las 4/.test(s)), JSON.stringify(r.salvedades));
});

test("las exigencias de texto libre SIEMPRE salen como sin verificar", () => {
  // No se pueden comprobar contra una publicacion de WhatsApp. Callarlas seria
  // dejar que el asesor asuma que estan verificadas.
  const r = evaluarOferta(OFERTA, MANDATO);
  const texto = r.salvedades.join(" ");
  for (const e of MANDATO.exigencias) assert.ok(texto.includes(e), `falta la exigencia "${e}"`);
});

test("un dato que la oferta no trae no inventa que cumple", () => {
  const r = evaluarOferta({ ...OFERTA, area: null }, MANDATO);
  assert.ok(!r.cumple.some((c) => /m²/.test(c)), "sin area, no se puede afirmar que cumple el area");
});

test("criterioDeMandato traduce al shape que espera evaluarCandidata", () => {
  const c = criterioDeMandato(MANDATO);
  assert.deepStrictEqual(c.zonas, ["El Poblado"]);
  assert.strictEqual(c.precio_max, 2200000000);
  assert.strictEqual(c.habitaciones, 4);
  assert.strictEqual(c.area_min, 150);
  assert.strictEqual(c.operacion, "venta");
});
