// Compuerta de calidad para publicar en un grupo gremial.
//
// Cada caso de esta suite corresponde a un camino REAL por el que hoy saldria
// un dato falso al grupo, encontrado en la auditoria del 2026-08-16. Si alguno
// de estos tests se pone en verde por relajar la regla en vez de arreglar el
// dato, se perdio el punto entero del modulo.

const { test } = require("node:test");
const assert = require("node:assert");
const publicable = require("../src/groups/publicable");

// Un match que pasa todo. Los casos de abajo lo rompen de a un campo.
function matchBueno(extra = {}) {
  return {
    fuente: "diamond",
    ref: "AP004",
    titulo: "Apartamento en Venta Envigado - Cerca al Metro",
    zona: "Centro, Envigado",
    precio: "$395.000.000",
    operacion: "Venta",
    link: "https://diamondinmobiliaria.com/propiedades/apartamento-en-venta-envigado-ap004",
    linkWasi: "https://info.wasi.co/apartamento-venta-envigado-centro/9744456",
    habitaciones: 2,
    area: "62m2",
    puntaje: 88,
    razones: ["Zona: Centro, Envigado"],
    ...extra,
  };
}

function motivos(match, opts) {
  return publicable.esPublicable(match, opts).motivos;
}

test("un match completo y con score alto se publica", () => {
  const v = publicable.esPublicable(matchBueno());
  assert.deepStrictEqual(v.motivos, []);
  assert.strictEqual(v.ok, true);
});

test("la ref 9921388 no sale hasta que se corrija en Wasi", () => {
  // Precio errado conocido, y titulo que no coincide con la ubicacion del link.
  // Esta marcada como pendiente en CLAUDE.md desde hace semanas.
  const v = publicable.esPublicable(matchBueno({ ref: "9921388" }));
  assert.strictEqual(v.ok, false);
  assert.ok(v.motivos.includes("ref_bloqueada"));
});

test("un precio en $0 no se publica", () => {
  // Label vacio en Wasi. Antes se colaba porque 0 es falsy.
  assert.ok(motivos(matchBueno({ precio: "$0" })).includes("sin_precio"));
  assert.ok(motivos(matchBueno({ precio: null })).includes("sin_precio"));
  assert.ok(motivos(matchBueno({ precio: "Precio a convenir" })).includes("sin_precio"));
});

test("un precio absurdo no se publica aunque sea un numero valido", () => {
  // El bug de digitos concatenados ya lo ataja el parser, pero si algun dia
  // entra por otra via, el rango lo detiene igual.
  assert.ok(motivos(matchBueno({ precio: "4500000002024" })).includes("precio_fuera_de_rango"));
  assert.ok(motivos(matchBueno({ precio: "$1.500.000" })).includes("precio_fuera_de_rango"));
});

test("el rango de precio depende de la operacion", () => {
  // $2.200.000 es un arriendo normal y una venta imposible.
  const arriendo = matchBueno({ operacion: "Arriendo", precio: "$2.200.000" });
  assert.deepStrictEqual(motivos(arriendo), []);
  const venta = matchBueno({ operacion: "Venta", precio: "$2.200.000" });
  assert.ok(motivos(venta).includes("precio_fuera_de_rango"));
});

test("sin zona no se publica — son 17 de 114 propiedades", () => {
  assert.ok(motivos(matchBueno({ zona: "" })).includes("sin_zona"));
  assert.ok(motivos(matchBueno({ zona: null })).includes("sin_zona"));
});

test("sin area no se publica — Wasi produce '2m2' con un typo", () => {
  assert.ok(motivos(matchBueno({ area: "" })).includes("sin_area"));
  assert.ok(motivos(matchBueno({ area: null })).includes("sin_area"));
});

test("nunca se publica inventario de un aliado", () => {
  // El aliado puede estar leyendo el mismo grupo.
  const v = publicable.esPublicable(matchBueno({ fuente: "aliado", inmobiliaria: "Otra SAS" }));
  assert.strictEqual(v.ok, false);
  assert.ok(v.motivos.includes("no_es_inventario_propio"));
});

test("el link tiene que ser el de la landing propia", () => {
  assert.ok(motivos(matchBueno({ link: "https://info.wasi.co/apartamento-venta/9744456" })).includes("link_ajeno"));
  assert.ok(motivos(matchBueno({ link: "https://paraisoinmobiliario.inmo.co/x" })).includes("link_ajeno"));
  assert.ok(motivos(matchBueno({ link: null })).includes("sin_link"));
});

test("sin linkWasi tampoco se publica — es lo que de verdad usa el mensaje 'blanqueado'", () => {
  // withLandingLink SIEMPRE arma un `link` propio (aunque Wasi no haya
  // traido ninguno), asi que validar solo `link` no alcanza: el mensaje real
  // (redactar.js) usa linkWasi, y sin esta compuerta saldria con un renglon
  // vacio en vez de callarse.
  assert.ok(motivos(matchBueno({ linkWasi: null })).includes("sin_link_wasi"));
  assert.ok(motivos(matchBueno({ linkWasi: "" })).includes("sin_link_wasi"));
});

test("un puntaje por debajo del umbral no se publica", () => {
  assert.ok(motivos(matchBueno({ puntaje: 69 })).includes("puntaje_bajo"));
  assert.deepStrictEqual(motivos(matchBueno({ puntaje: 70 })), []);
  // El umbral es configurable sin tocar codigo ni redesplegar.
  assert.ok(motivos(matchBueno({ puntaje: 88 }), { umbral: 90 }).includes("puntaje_bajo"));
  assert.deepStrictEqual(motivos(matchBueno({ puntaje: 60 }), { umbral: 55 }), []);
});

test("el umbral por defecto es alcanzable con el inventario real", () => {
  // Medido el 2026-08-16 contra las 108 propiedades disponibles: el techo sin
  // pedir alcobas es 73. Un umbral de 80 dejaba al bot mudo justo en la demanda
  // del ejemplo ("100 mts2 con parqueadero, 1.200 millones"), porque `garaje`
  // solo esta sincronizado en 29 de 108 y esos 6 puntos no se pueden ganar.
  // Si alguien sube este default, que sea con datos, no por intuicion.
  assert.ok(publicable.UMBRAL_DEFAULT <= 73, "el umbral no puede exceder el techo real del inventario");
  assert.deepStrictEqual(motivos(matchBueno({ puntaje: 73 })), []);
});

test("si el sync de Wasi esta viejo no se publica nada", () => {
  // DMAP ya se detuvo 16 dias sin que nadie se enterara. Con el sync frenado no
  // se sabe que se vendio desde entonces.
  const v = publicable.esPublicable(matchBueno(), { syncFresco: false });
  assert.strictEqual(v.ok, false);
  assert.ok(v.motivos.includes("sync_viejo"));
});

test("los motivos se acumulan — una pasada audita todo el dato", () => {
  const malo = matchBueno({ precio: "$0", zona: "", area: "", fuente: "aliado" });
  const v = publicable.esPublicable(malo);
  assert.ok(v.motivos.includes("sin_precio"));
  assert.ok(v.motivos.includes("sin_zona"));
  assert.ok(v.motivos.includes("sin_area"));
  assert.ok(v.motivos.includes("no_es_inventario_propio"));
});

// SIN TOPE por defecto (Juan, 2026-08-20): "que no se restrinja a 3, que se
// envien los que tengan un scoring alto" — filtrar() manda TODO lo que pasa
// la compuerta, ordenado de mejor a peor, y solo la calidad decide cuantas.
test("filtrar devuelve TODAS las que pasan la compuerta, ordenadas por puntaje, y explica cada descarte", () => {
  const entrada = [
    matchBueno({ ref: "A", puntaje: 82 }),
    matchBueno({ ref: "B", puntaje: 95 }),
    matchBueno({ ref: "C", puntaje: 88 }),
    matchBueno({ ref: "D", puntaje: 90 }),
    matchBueno({ ref: "E", puntaje: 99, precio: "$0" }),
  ];
  const { publicables, descartados } = publicable.filtrar(entrada);

  assert.deepStrictEqual(publicables.map((m) => m.ref), ["B", "D", "C", "A"]);
  assert.deepStrictEqual(descartados, [{ ref: "E", motivos: ["sin_precio"] }]);
});

test("un limite explicito SI se respeta — el default es sin tope, no la unica opcion", () => {
  const entrada = [
    matchBueno({ ref: "A", puntaje: 82 }),
    matchBueno({ ref: "B", puntaje: 95 }),
    matchBueno({ ref: "C", puntaje: 88 }),
  ];
  const { publicables } = publicable.filtrar(entrada, { limite: 2 });
  assert.deepStrictEqual(publicables.map((m) => m.ref), ["B", "C"]);
});

test("si nada pasa la compuerta, la lista queda vacia y no se responde", () => {
  const { publicables, descartados } = publicable.filtrar([
    matchBueno({ ref: "X", precio: "$0" }),
    matchBueno({ ref: "9921388" }),
  ]);
  assert.deepStrictEqual(publicables, []);
  assert.strictEqual(descartados.length, 2);
});
