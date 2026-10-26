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

// ── LA FICHA DICE DONDE QUEDA (segunda revision del DM amplio, N1, 2026-10-26)
// Con el grado `zona_general` la ficha salia con "el barrio exacto no lo tengo
// registrado" aunque el texto decia donde queda. Textos reales de produccion
// (SELECT de `properties`, 2026-10-26).
const palmas = ["Alto de las Palmas", "Balsos", "Patio Bonito", "San Lucas"]; // pedido 212c5bbf
const campestre10410315 = () => ficha({
  ref: "10410315", zona: "El Poblado", operacion: "Arriendo", precio: "$10.500.000",
  titulo: "ARRIENDO APARTAMENTO AMOBLADO EN EL POBLADO - SECTOR CAMPESTRE",
  descripcion: "<p>🏠Apartamento remodelado poblado sector campestre</p>\n\n<div>&nbsp;</div>\n\n<div>*&Aacute;rea*:135 M2</div>\n\n<div>*Piso*: 15</div>\n\n<div>✓ 🍃*Unidad completa*&nbsp;&nbsp;</div>\n\n<div>Disponible para ingreso inmediato 👉&nbsp;</div>",
});
const country9856842 = () => ficha({
  ref: "9856842", zona: "El Poblado", tipo: "Casa", precio: "$2.200.000.000",
  titulo: "OPORTUNIDAD DE INVERSIÓN CASA PALMAS SECTOR COUNTRY CLUB ",
  descripcion: "<p>🏡✨ <strong>CASA DE LUJO EN VENTA EN LAS PALMAS &ndash; SECTOR COUNTRY CLUB</strong></p>\n\n<p>📍 <strong>Avenida Las Palmas &ndash; Sector Country Club</strong><br />\n🏘️ Urbanizaci&oacute;n privada y exclusiva de solo <strong>8 casas</strong></p>\n\n<p>✔️ Al lado del Country Club<br />\n✔️ Sector sin pico y placa<br />\n",
});
const palmas10447697 = () => ficha({
  ref: "10447697", zona: "El Poblado",
  titulo: "APARTAMENTO EN RENTA POBLADO - PALMAS",
  descripcion: "<p>Apartamento en el Poblado-Palmas&nbsp;</p>\n\n<div>🍀2 habitaciones&nbsp;</div>",
});

test("N1 9856842: 'EN LAS PALMAS – SECTOR COUNTRY CLUB' confirma Las Palmas y Alto de las Palmas", () => {
  assert.strictEqual(barrio.nombra(country9856842(), "Las Palmas"), true);
  assert.strictEqual(barrio.nombra(country9856842(), "Alto de las Palmas"), true);
  for (const zonas of [["Las Palmas"], ["Alto de las Palmas"], palmas]) {
    const m = match.evaluarCandidata(country9856842(), pide({ tipo: "casa", zonas, zona_madre: "El Poblado", precio_max: 2300000000 }), "diamond");
    assert.ok(m, zonas.join("/"));
    assert.strictEqual(m.ubicacion, "exacta", zonas.join("/"));
  }
});

test("N1 10447697: 'Poblado-Palmas' confirma Las Palmas", () => {
  assert.strictEqual(barrio.nombra(palmas10447697(), "Las Palmas"), true);
});

test("N1 10410315: 'sector campestre' es donde queda: barrio_en_ficha, nunca 'el barrio exacto no lo tengo registrado'", () => {
  assert.deepStrictEqual(barrio.mencionaOtroBarrio(campestre10410315(), palmas), ["campestre"]);
  const m = match.evaluarCandidata(campestre10410315(), pide({ operacion: "arriendo", zonas: palmas, zona_madre: "El Poblado", precio_max: 11000000 }), "diamond");
  assert.ok(m);
  assert.strictEqual(m.ubicacion, "zona_general");
  assert.deepStrictEqual(m.barrio_en_ficha, ["campestre"]);
  const r = publicable.filtrar([m], { umbral: 0, conAclaracion: true });
  assert.deepStrictEqual(r.publicables, []);
  assert.deepStrictEqual(r.aclaraciones, []);
});

test("N1: 'sector X' solo cuenta si X no es lo pedido", () => {
  assert.deepStrictEqual(barrio.mencionaOtroBarrio(campestre10410315(), ["Campestre"]), []);
});

test("N1: las frases de todos los dias no son un lugar (ni confirman ni nombran otro)", () => {
  const p = ficha({
    zona: "El Poblado",
    titulo: "APARTAMENTO EN VENTA EN EXCELENTE ESTADO",
    descripcion: "En unidad cerrada, sector tranquilo, sector residencial, sector exclusivo, barrio tranquilo, "
      + "urbanización cerrada, urbanización privada y exclusiva, sector sin pico y placa, sector de alta valorización, "
      + "sector con excelente ubicación, sector muy seguro, en piso alto, en la mesa del comedor, en el tesoro de la casa.",
  });
  assert.deepStrictEqual(barrio.mencionaOtroBarrio(p, palmas), []);
  assert.strictEqual(barrio.nombra(p, "Barrio Mesa"), false);
  assert.strictEqual(barrio.nombra(p, "El Tesoro"), false, "palabra comun: 'en el tesoro' no confirma");
  assert.strictEqual(barrio.nombra(p, "Las Palmas"), false);
});
