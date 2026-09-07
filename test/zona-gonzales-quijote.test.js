// Los dos arriendos amoblados de Diamond, invisibles hasta hoy.
//
// EL CASO REAL (medido 2026-09-07 contra produccion). Diamond tiene
// exactamente DOS propiedades en arriendo, las dos amobladas, y son la razon
// de ser de la feature "amoblados":
//   - ref 10319436 -- zona "Los Gonzáles", El Poblado
//   - ref 10319552 -- zona "Don Quijote", asociada a Laureles
//
// NINGUNA de las dos era alcanzable. `ubicacionCoincide` devolvia null para
// un pedido de "El Poblado" contra una propiedad en "Los Gonzáles": la
// propiedad nunca llegaba a ser candidata, asi que la compuerta de amoblado
// (src/groups/match.js) nunca alcanzaba a evaluarla. La feature completa
// habria salido inerte.
//
// La misma medicion sobre las 49 zonas distintas del inventario disponible
// mostro que el resto del mapa esta sano: las unicas otras zonas
// inalcanzables son lugares genuinamente lejanos (Urrao, Guatape, San
// Jeronimo, La Ceja) que con razon no deberian calzar contra un pedido de
// barrio en Medellin.
//
// LA DECISION (Juan, 2026-09-07): Los Gonzales es El Poblado (comuna 14);
// Don Quijote se asocia a Laureles. Se registra en las dos estructuras de
// src/lib/zonas.js -- VECINDAD (para que el prefiltro SQL siquiera traiga la
// fila) y SUBZONA_DE (para que se gradue 'exacta', no 'vecina') -- siguiendo
// el mismo patron que la entrada de "palmas" (ver ese comentario en
// zonas.js).
const { test } = require("node:test");
const assert = require("node:assert");
const match = require("../src/groups/match");

const PEDIDO_POBLADO = {
  operacion: "arriendo", tipo: "apartamento", zona: "El Poblado", zonas: ["El Poblado"],
  ciudad: "", habitaciones: 0, precio_max: 0, precio_min: 0, area_min: 0,
  banos: 0, garajes: 0, estrato: 0, amoblado: "", periodo: "",
};

const PEDIDO_LAURELES = {
  operacion: "arriendo", tipo: "apartamento", zona: "Laureles", zonas: ["Laureles"],
  ciudad: "", habitaciones: 0, precio_max: 0, precio_min: 0, area_min: 0,
  banos: 0, garajes: 0, estrato: 0, amoblado: "", periodo: "",
};

test("ref 10319436: pedido 'El Poblado' contra 'Los Gonzáles' gradua EXACTA", () => {
  const propiedad = {
    ref: "10319436", tipo: "Apartamento", operacion: "Arriendo", zona: "Los Gonzáles",
    ciudad: "Medellín", precio: "$7.900.000", area: "90m2", habitaciones: 3, disponible: true,
  };
  const u = match.ubicacionCoincide(propiedad, PEDIDO_POBLADO);
  assert.ok(u, "antes del registro esto daba null: la propiedad nunca llegaba a candidata");
  assert.strictEqual(u.grado, "exacta");
});

test("ref 10319552: pedido 'Laureles' contra 'Don Quijote' gradua EXACTA", () => {
  const propiedad = {
    ref: "10319552", tipo: "Apartamento", operacion: "Arriendo", zona: "Don Quijote",
    ciudad: "Medellín", precio: "$5.500.000", area: "70m2", habitaciones: 2, disponible: true,
  };
  const u = match.ubicacionCoincide(propiedad, PEDIDO_LAURELES);
  assert.ok(u, "antes del registro esto daba null");
  assert.strictEqual(u.grado, "exacta");
});

// LA TRAMPA DE "DON". Es una palabra comun en nombres propios de zona
// ("Don Diego", "Don Bosco", etc). Si alguien registrara SUBZONA_DE con la
// clave "don" en vez de "quijote", cualquier zona que contenga la palabra
// "don" quedaria pegada a Laureles -- un falso positivo silencioso, del
// mismo tipo que "san"/"loma" (ver GENERIC_GEO en zonas.js). Este test
// habria fallado si alguien hubiera registrado "don" en vez de "quijote".
test("BUG evitado: una zona con la palabra 'Don' pero SIN relacion con Laureles no gradua exacta", () => {
  const propiedadNoRelacionada = {
    ref: "77777", tipo: "Apartamento", operacion: "Arriendo", zona: "Don Diego",
    ciudad: "Medellín", precio: "$5.500.000", area: "70m2", habitaciones: 2, disponible: true,
  };
  const u = match.ubicacionCoincide(propiedadNoRelacionada, PEDIDO_LAURELES);
  // "Don Diego" no tiene ninguna vecindad ni subzona declarada con Laureles,
  // y no comparte ciudad con el pedido (el pedido no trae ciudad): no puede
  // calzar en ningun grado.
  assert.strictEqual(u, null, "el token 'don' no puede arrastrar zonas ajenas a Laureles");
});
