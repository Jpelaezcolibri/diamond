// Veredas de las fincas en arriendo (Juan, 2026-10-21). El sync de ese dia
// trajo de Wasi la vereda como zona ("Vereda Las Canoas", "El Espinal") donde
// antes estaba vacia, y la zona vacia caia a la ciudad. Desde ese momento un
// pedido de "finca en Copacabana" no encontraba la 10479033, ni uno de "Santa
// Fe de Antioquia" la 10467617; la de Guatape (La Peña) ya no cruzaba antes.
const { test } = require("node:test");
const assert = require("node:assert");
const match = require("../src/groups/match");
const zonas = require("../src/lib/zonas");

const pide = (zona) => ({ tipo: "finca", operacion: "arriendo", zona, zonas: [], ciudad: null, precio_max: 2000000 });
const finca = (zona, ciudad) => ({
  ref: "1", titulo: "Finca amoblada en renta", tipo: "Finca", operacion: "Arriendo", precio: "$1.200.000",
  zona, ciudad, habitaciones: 4, banos: 3, garaje: 2, estrato: 3, area: "1000 m²",
  link: "https://diamondinmobiliaria.com/propiedades/x-1",
});
const grado = (pedida, ficha, ciudad) => match.evaluarCandidata(finca(ficha, ciudad), pide(pedida), "diamond")?.ubicacion;

test("un pedido por municipio encuentra la finca registrada con su vereda", () => {
  assert.strictEqual(grado("Copacabana", "Vereda Las Canoas", "Copacabana"), "exacta");
  assert.strictEqual(grado("Santa Fe de Antioquia", "El Espinal", "Santa Fe de Antioquia"), "exacta");
  assert.strictEqual(grado("Guatapé", "La Peña", "Guatapé"), "exacta");
});

test("cada vereda conoce su municipio", () => {
  assert.deepStrictEqual(zonas.madresDe(["canoas"]), ["copacabana"]);
  assert.deepStrictEqual(zonas.madresDe(["espinal"]), ["antioquia"]);
  assert.deepStrictEqual(zonas.madresDe(["pena"]), ["guatape"]);
});

test("la vereda no se cuela en otro municipio", () => {
  assert.notStrictEqual(grado("Envigado", "Vereda Las Canoas", "Copacabana"), "exacta");
  assert.notStrictEqual(grado("Copacabana", "La Peña", "Guatapé"), "exacta");
});
