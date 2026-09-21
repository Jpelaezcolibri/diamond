// El barrio se lee del texto de la ficha (Juan, 2026-09-21).
//
// La regla: "si alguien pide envigado se puede enviar todo lo de envigado pero
// si dice envigado barrio mesa solo enviar envigado barrio mesa, todo depende
// del pedido del colega".
//
// Por que del texto: Wasi guarda casi siempre solo la zona general ("Envigado")
// y el barrio lo pone en el titulo — "VENDO APARTAMENTO ENVIGADO BARRIO MESA",
// "SECTOR LA CUENCA ENVIGADO", "SECTOR EL PORTAL". Medido ese dia: 63 de las
// 102 fichas disponibles nombran algo en el texto.
//
// Las trampas son las mismas que las del piso: no fallan ruidosamente. Estan
// en el inventario real:
//   · la cercania: la 9776475 dice "Cerca a Laureles" y NO esta en Laureles; la
//     10031500 dice "SECTOR CAMPESTRE VIA LAS ANTILLAS" y no esta en Las Antillas.
//   · la palabra comun: "mesa", "portal", "cuenca", "paz" son palabras de todos
//     los dias; solas no dicen nada.
//   · "sector" suelto: "Sector sin pico y placa", "sector tranquilo".
const { test } = require("node:test");
const assert = require("node:assert");
const barrio = require("../src/groups/barrio");
const match = require("../src/groups/match");
const publicable = require("../src/groups/publicable");

const ficha = (extra = {}) => ({
  ref: "X", tipo: "Apartamento", operacion: "Venta", precio: "$450.000.000", zona: "Envigado", ciudad: "Medellín",
  habitaciones: 3, banos: 2, garaje: 1, estrato: 3, area: "83m2", link: "https://diamondinmobiliaria.com/propiedades/x",
  titulo: "", descripcion: "", ...extra,
});
const mesa = () => ficha({
  ref: "10077063",
  titulo: "VENDO APARTAMENTO ENVIGADO BARRIO MESA PERMITE RENTAS CORTAS",
  descripcion: '<p style="text-align:start"><span style="font-size:medium">Vendo Apartamento ubicado en Envigado Barrio mesa<br /> <br /> CUARTO PISO POR ESCALERA',
});
const cuenca = () => ficha({ ref: "10203968", titulo: "VENDO APARTAMENTO EN GUATAPURI SECTOR LA CUENCA ENVIGADO" });
const viaAntillas = () => ficha({ ref: "10031500", titulo: "VENDO APARTAMENTO SECTOR CAMPESTRE VIA LAS ANTILLAS ENVIGADO" });
const pide = (extra = {}) => ({
  tipo: "apartamento", operacion: "venta", zona: null, zonas: [], zona_madre: "", ciudad: null,
  habitaciones: 3, precio_max: 470000000, ...extra,
});

// ── Leer la ficha ─────────────────────────────────────────────────────────

test("la ficha que nombra el barrio en el titulo lo confirma", () => {
  assert.strictEqual(barrio.nombra(mesa(), "Barrio Mesa"), true);
});

test("el HTML y las entidades de Wasi no estorban", () => {
  const p = ficha({ descripcion: "<p><strong>Ubicaci&oacute;n:</strong> Envigado &ndash; sector Otraparte<br /></p>" });
  assert.strictEqual(barrio.nombra(p, "Otraparte"), true);
});

test("un nombre de varias palabras se reconoce aunque diga 'unidad' adelante", () => {
  const p = ficha({ titulo: "APARTAMENTO EN UNIDAD CAMINO DE LAS AGUAS ENVIGADO" });
  assert.strictEqual(barrio.nombra(p, "Camino de las Aguas"), true);
});

test("la palabra comun sola no confirma nada: 'mesa' de comedor no es Barrio Mesa", () => {
  const p = ficha({ descripcion: "Cocina integral con mesa auxiliar y comedor para seis." });
  assert.strictEqual(barrio.nombra(p, "Barrio Mesa"), false);
});

test("CERCANIA: 'Cerca a Laureles' no es estar en Laureles (ref 9776475)", () => {
  const p = ficha({ zona: "", titulo: "Venta de Apartaloft Cerca a Laureles Para Rentas Cortas" });
  assert.strictEqual(barrio.nombra(p, "Laureles"), false);
});

test("CERCANIA: 'via Las Antillas' no es estar en Las Antillas (ref 10031500)", () => {
  assert.strictEqual(barrio.nombra(viaAntillas(), "Las Antillas"), false);
});

test("CERCANIA: 'a dos cuadras del parque de El Portal' no es El Portal", () => {
  const p = ficha({ descripcion: "Ubicado a dos cuadras del sector El Portal, excelente zona." });
  assert.strictEqual(barrio.nombra(p, "El Portal"), false);
});

test("la ficha que nombra OTRO barrio conocido del municipio lo dice", () => {
  assert.deepStrictEqual(barrio.otrosBarrios(mesa(), ["Camino de las Aguas"]), ["mesa"]);
  assert.deepStrictEqual(barrio.otrosBarrios(cuenca(), ["Camino de las Aguas"]), ["cuenca"]);
});

test("'sector tranquilo' o 'sector campestre' no son un barrio distinto", () => {
  assert.deepStrictEqual(barrio.otrosBarrios(viaAntillas(), ["Camino de las Aguas"]), []);
  const p = ficha({ descripcion: "Sector tranquilo, sector sin pico y placa, cerca de todo." });
  assert.deepStrictEqual(barrio.otrosBarrios(p, ["Barrio Mesa"]), []);
});

// ── En el motor ───────────────────────────────────────────────────────────

test("EL CASO: pedir Barrio Mesa trae la 10077063 como exacta, porque su ficha lo dice", () => {
  const m = match.evaluarCandidata(mesa(), pide({ zonas: ["Barrio Mesa"], zona_madre: "Envigado" }), "diamond");
  assert.ok(m);
  assert.strictEqual(m.ubicacion, "exacta");
  assert.match(m.razones.join(" | "), /Barrio Mesa|Mesa/i);
});

test("y sale sola: el sector esta confirmado", () => {
  const m = match.evaluarCandidata(mesa(), pide({ zonas: ["Barrio Mesa"], zona_madre: "Envigado" }), "diamond");
  const v = publicable.esPublicable(m, { umbral: 0, syncFresco: true });
  assert.ok(!v.motivos.includes("sector_sin_confirmar"), v.motivos.join(","));
});

test("EL CASO: pedir Camino de las Aguas NO trae la 10077063: su ficha dice Barrio Mesa", () => {
  const m = match.evaluarCandidata(mesa(), pide({ zonas: ["Camino de las Aguas"], zona_madre: "Envigado" }), "diamond");
  assert.strictEqual(m, null);
});

test("Camino de las Aguas tampoco trae la de La Cuenca", () => {
  const m = match.evaluarCandidata(cuenca(), pide({ zonas: ["Camino de las Aguas"], zona_madre: "Envigado" }), "diamond");
  assert.strictEqual(m, null);
});

test("si la ficha no dice el barrio, queda sin confirmar (no sale sola, pero no desaparece)", () => {
  const m = match.evaluarCandidata(viaAntillas(), pide({ zonas: ["Camino de las Aguas"], zona_madre: "Envigado" }), "diamond");
  assert.ok(m);
  assert.strictEqual(m.ubicacion, "zona_general");
});

test("pedir solo Envigado sigue trayendo todo Envigado, diga lo que diga la ficha", () => {
  for (const p of [mesa(), cuenca(), viaAntillas()]) {
    const m = match.evaluarCandidata(p, pide({ zonas: ["Envigado"] }), "diamond");
    assert.ok(m, p.ref);
    assert.strictEqual(m.ubicacion, "exacta", p.ref);
  }
});

test("el pedido de Juanita (nueve sectores, entre ellos Barrio Mesa) encuentra la 10077063 exacta", () => {
  const sectores = ["El Trianon", "La Paz", "Las Antillas", "El Dorado", "Alcala", "Barrio Mesa", "El Oasis", "San Marcos", "La Magnolia"];
  const m = match.evaluarCandidata(mesa(), pide({ zonas: sectores, zona_madre: "Envigado" }), "diamond");
  assert.ok(m);
  assert.strictEqual(m.ubicacion, "exacta");
});
