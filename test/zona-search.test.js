const { test } = require("node:test");
const assert = require("node:assert");
const { matchesFilters, distinctiveTokens, zonaTokens } = require("../src/data/properties");

// Inventario minimo de referencia (zonas reales del catalogo Diamond).
const lomaChocho = { ref: "9702941", zona: "Loma del Chocho", ciudad: "Envigado", tipo: "Apartamento", habitaciones: 2, precio: "$720.000.000", disponible: true };
const poblado = { ref: "9856842", zona: "El poblado", ciudad: "Medellin", tipo: "Apartamento", habitaciones: 3, precio: "$900.000.000", disponible: true };
const castropol = { ref: "8989725", zona: "Castropol", ciudad: "Medellin", tipo: "Apartamento", habitaciones: 3, precio: "$920.000.000", disponible: true };

test("BUG: 'loma del indio' NO matchea 'Loma del Chocho' solo por la palabra 'loma'", () => {
  // Loma del Indio (El Poblado) esta lejos de Loma del Chocho (Envigado):
  // un match por la palabra generica "loma" ubicaba al cliente en el sitio equivocado.
  assert.strictEqual(matchesFilters(lomaChocho, { zona: "loma del indio" }), false);
});

test("'loma del chocho' SI matchea 'Loma del Chocho' (token distintivo: chocho)", () => {
  assert.strictEqual(matchesFilters(lomaChocho, { zona: "loma del chocho" }), true);
});

test("'el poblado' matchea propiedades del Poblado", () => {
  assert.strictEqual(matchesFilters(poblado, { zona: "el poblado" }), true);
});

test("'castropol' matchea Castropol pero no Loma del Chocho", () => {
  assert.strictEqual(matchesFilters(castropol, { zona: "castropol" }), true);
  assert.strictEqual(matchesFilters(lomaChocho, { zona: "castropol" }), false);
});

// BUG real (Juan, 2026-08-20): "Loma de San Julián" (El Poblado) matcheaba
// exacta contra "San Joaquín, Laureles" y "Tierra Firme San Germán" — sin
// ninguna relacion, solo por compartir el token "san". Se publico en vivo
// antes de notarse (pedido de Catalina): 2 de 3 propiedades ofrecidas no
// tenian nada que ver con lo pedido. Mismo defecto que "loma", con "san".
test("BUG: 'San Joaquin' NO matchea 'Loma de San Julian' solo por la palabra 'san'", () => {
  const sanJoaquin = { ref: "10013037", zona: "San Joaquin", ciudad: "Medellin", tipo: "Apartamento", habitaciones: 3, precio: "$480.000.000", disponible: true };
  assert.strictEqual(matchesFilters(sanJoaquin, { zona: "Loma de San Julián" }), false);
});

test("BUG: 'Tierra Firme San German' NO matchea 'Loma de San Julian' solo por 'san'", () => {
  const tierraFirme = { ref: "10234389", zona: "Tierra Firme San German", ciudad: "Medellin", tipo: "Apartamento", habitaciones: 3, precio: "$585.000.000", disponible: true };
  assert.strictEqual(matchesFilters(tierraFirme, { zona: "Loma de San Julián" }), false);
});

test("distinctiveTokens descarta genericas si hay una distintiva", () => {
  assert.deepStrictEqual(distinctiveTokens(zonaTokens("loma del indio")), ["indio"]);
  assert.deepStrictEqual(distinctiveTokens(zonaTokens("loma de los balsos")), ["balsos"]);
  // Sin tilde desde el 2026-09-05: los tokens se aplanan (ver sinAcentos).
  assert.deepStrictEqual(distinctiveTokens(zonaTokens("San Joaquín")), ["joaquin"]);
  assert.deepStrictEqual(distinctiveTokens(zonaTokens("Loma de San Julián")), ["julian"]);
});

// LAS TILDES NO DISTINGUEN BARRIOS (auditoria 2026-09-05). Medido contra
// produccion: el inventario guarda "Belén" e "Itagüi"; los colegas piden
// "Belén" (25 pedidos en 10 dias), "Itagüí" (12), "Belen", "Itagui". Con los
// tokens con tilde, "Itagüí" no encontraba NINGUNA propiedad (la base dice
// "Itagüi") y "Belen" encontraba 3 de 6.
test("zonaTokens aplana tildes, dieresis y eñe: la misma zona da los mismos tokens", () => {
  assert.deepStrictEqual(zonaTokens("Belén"), zonaTokens("Belen"));
  assert.deepStrictEqual(zonaTokens("Itagüí"), ["itagui"]);
  assert.deepStrictEqual(zonaTokens("Itagüi"), ["itagui"]);
  assert.deepStrictEqual(zonaTokens("Zúñiga"), zonaTokens("Zuniga"));
  assert.deepStrictEqual(zonaTokens("Ciudad del Río"), zonaTokens("ciudad del rio"));
});

test("matchesFilters encuentra la zona sin importar la tilde de ninguno de los dos lados", () => {
  const belen = { ref: "1", zona: "Belén", ciudad: "Medellín", tipo: "Casa", habitaciones: 3, precio: "$400.000.000", disponible: true };
  assert.strictEqual(matchesFilters(belen, { zona: "Belen" }), true);
  assert.strictEqual(matchesFilters(belen, { zona: "Belén" }), true);
  const itagui = { ref: "2", zona: "Itagüi", ciudad: "Medellín", tipo: "Apartamento", habitaciones: 3, precio: "$300.000.000", disponible: true };
  assert.strictEqual(matchesFilters(itagui, { zona: "Itagüí" }), true);
  assert.strictEqual(matchesFilters(itagui, { zona: "Itagui" }), true);
});

test("patronSinTildes arma el regex que la consulta SQL usa en vez de ilike", () => {
  const { patronSinTildes } = require("../src/lib/zonas");
  assert.strictEqual(patronSinTildes("belen"), "b[eéèëê]l[eéèëê][nñ]");
  assert.strictEqual(patronSinTildes("itagui"), "[iíìïî]t[aáàäâ]g[uúùüû][iíìïî]");
  // Un token que ya viene con tilde se aplana antes: mismo patron.
  assert.strictEqual(patronSinTildes("belén"), patronSinTildes("belen"));
  // Y el patron reconoce las formas reales del inventario.
  assert.ok(new RegExp(patronSinTildes("belen"), "i").test("Belén"));
  assert.ok(new RegExp(patronSinTildes("belen"), "i").test("Belen Rosales"));
  assert.ok(new RegExp(patronSinTildes("itagui"), "i").test("Itagüi"));
  assert.ok(!new RegExp(patronSinTildes("laureles"), "i").test("Laurel"), "sigue siendo token completo, no substring inverso");
});

test("distinctiveTokens usa las genericas como ultimo recurso si no hay distintivas", () => {
  // Query solo con palabra generica: no se pierde del todo, se usa como fallback.
  assert.deepStrictEqual(distinctiveTokens(zonaTokens("la loma")), ["loma"]);
});

test("sin zona, matchesFilters no filtra por ubicacion", () => {
  assert.strictEqual(matchesFilters(lomaChocho, {}), true);
});

test("el filtro de precio no se rompe con el texto que trae el label de Wasi", () => {
  // Regresion del 2026-08-16. `parseInt(replace(/\D/g,""))` sobre
  // "$450.000.000 negociable 2024" pegaba todos los digitos y devolvia
  // 4500000002024: la propiedad quedaba fuera de CUALQUIER presupuesto, en
  // silencio y sin que nada fallara. Mismo bug que se corrigio en
  // src/groups/match.js; esta era la otra mitad, la que ve el cliente.
  const sucia = { ...castropol, precio: "$450.000.000 negociable 2024" };
  assert.strictEqual(matchesFilters(sucia, { precio_max: 600000000 }), true);
  assert.strictEqual(matchesFilters(sucia, { precio_max: 400000000 }), false);

  const limpia = { ...castropol, precio: "$820.000.000" };
  assert.strictEqual(matchesFilters(limpia, { precio_max: 900000000 }), true);
  assert.strictEqual(matchesFilters(limpia, { precio_max: 800000000 }), false);

  // Un precio sin numero util no puede excluir la propiedad: es un hueco del
  // sync, no un defecto del inmueble. Mismo criterio que match.js.
  const sinPrecio = { ...castropol, precio: "Precio a convenir" };
  assert.strictEqual(matchesFilters(sinPrecio, { precio_max: 100000000 }), true);
});
