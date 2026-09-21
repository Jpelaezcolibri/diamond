// Los barrios de Envigado (Juan, 2026-09-14).
//
// EL CASO. Juanita Monsalve pidio "ENVIGADO · SECTORES: El Trianon, La Paz,
// Las Antillas, El Dorado, Alcala, Barrio Mesa, El Oasis, San Marcos, La
// Magnolia" y no le salio nada, con la 10077063 ("VENDO APARTAMENTO ENVIGADO
// BARRIO MESA") en el inventario: su zona dice "Envigado" y su ciudad
// "Medellín". El motor no sabia que Barrio Mesa queda en Envigado, y la
// consulta SQL ni siquiera traia la propiedad.
//
// Medido ese dia: de 286 pedidos que mencionan Envigado desde el 15-ago, los
// colegas nombran el barrio (Cumbres x9, Las Antillas x4, El Dorado x4...) y
// el inventario casi nunca lo registra.
//
// EL ARREGLO, en tres piezas:
//   · SUBZONA_DE (src/lib/zonas.js) sabe que cada barrio es de Envigado.
//   · La consulta trae la zona general del barrio pedido y los barrios de la
//     zona general pedida (match.js#filtrosInventario).
//   · Una propiedad registrada solo con la zona general entra con el grado
//     "zona_general": se ofrece, y el mensaje dice que el barrio exacto no lo
//     tenemos (regla D7: un dato que no registramos no es un incumplimiento).
const { test } = require("node:test");
const assert = require("node:assert");
const match = require("../src/groups/match");
const zonas = require("../src/lib/zonas");
const publicable = require("../src/groups/publicable");
const redactar = require("../src/groups/redactar");

const pide = (extra = {}) => ({
  tipo: "apartamento", operacion: "venta", zona: null, zonas: [], ciudad: null,
  habitaciones: 3, precio_max: 600000000, ...extra,
});
// El titulo NO nombra el barrio a proposito: desde el 2026-09-21 el motor lee
// el barrio del texto de la ficha (test/barrio-ficha.test.js), y estos tests
// prueban lo que pasa cuando la ficha no lo dice.
const apto = (extra = {}) => ({
  ref: "10077063", titulo: "Vendo apartamento en Envigado", tipo: "Apartamento",
  operacion: "Venta", precio: "$550.000.000", zona: "Envigado", ciudad: "Medellín",
  habitaciones: 3, banos: 2, garaje: 1, estrato: 4, area: "90 m²",
  link: "https://diamondinmobiliaria.com/propiedades/x-10077063", ...extra,
});
const tokensDeLaConsulta = (c) => String(match.filtrosInventario(c).zona || "").split(" ");

// ── zonas.js ──────────────────────────────────────────────────────────────

test("cada barrio sabe que queda en Envigado, y Envigado conoce sus barrios", () => {
  assert.deepStrictEqual(zonas.madresDe(["mesa"]), ["envigado"]);
  assert.deepStrictEqual(zonas.madresDe(["alcalá"]), ["envigado"], "sin tilde o con tilde");
  const hijas = zonas.hijasDe(["envigado"]);
  for (const b of ["mesa", "antillas", "cumbres", "trianon", "esmeraldal", "escobero"]) assert.ok(hijas.includes(b), b);
});

test("los tokens ambiguos NO quedaron como barrios de Envigado", () => {
  // "Zona Centro" de Envigado vs el Centro de Medellin; "jardines" y "villa"
  // demasiado comunes. Ver la nota en SUBZONA_DE.
  for (const t of ["centro", "jardines", "villa", "grande"]) assert.deepStrictEqual(zonas.madresDe([t]), [], t);
});

// ── La consulta ───────────────────────────────────────────────────────────

test("pedir Barrio Mesa trae de la base las propiedades registradas solo como Envigado", () => {
  const t = tokensDeLaConsulta(pide({ zona: "Barrio Mesa" }));
  assert.ok(t.includes("mesa"), t.join(" "));
  assert.ok(t.includes("envigado"), t.join(" "));
});

test("pedir Envigado trae tambien las propiedades registradas con su barrio", () => {
  const t = tokensDeLaConsulta(pide({ zona: "Envigado" }));
  for (const b of ["envigado", "antillas", "mesa", "cumbres"]) assert.ok(t.includes(b), `${b} en ${t.join(" ")}`);
});

// ── El grado ──────────────────────────────────────────────────────────────

test("EL CASO: Barrio Mesa contra una propiedad con zona 'Envigado' entra como zona_general", () => {
  const m = match.evaluarCandidata(apto(), pide({ zona: "Barrio Mesa" }), "diamond");
  assert.ok(m, "antes de este arreglo, null");
  assert.strictEqual(m.ubicacion, "zona_general");
  assert.match(m.razones.join(" | "), /el barrio exacto no está registrado/);
});

test("el pedido de Juanita, con sus nueve sectores, encuentra la 10077063", () => {
  const sectores = ["El Trianon", "La Paz", "Las Antillas", "El Dorado", "Alcala", "Barrio Mesa", "El Oasis", "San Marcos", "La Magnolia"];
  const m = match.evaluarCandidata(apto(), pide({ zona: sectores[0], zonas: sectores }), "diamond");
  assert.ok(m);
  assert.strictEqual(m.ubicacion, "zona_general");
});

test("zona vacia y ciudad Envigado (como guarda Wasi a veces) tambien es zona_general", () => {
  const m = match.evaluarCandidata(apto({ zona: "", ciudad: "Envigado" }), pide({ zona: "Cumbres" }), "diamond");
  assert.ok(m);
  assert.strictEqual(m.ubicacion, "zona_general");
});

test("pedir Envigado y encontrar Las Antillas es exactamente lo pedido", () => {
  const m = match.evaluarCandidata(apto({ zona: "Las Antillas" }), pide({ zona: "Envigado" }), "diamond");
  assert.ok(m);
  assert.strictEqual(m.ubicacion, "exacta");
});

test("un barrio de Envigado no trae una propiedad de otro lado", () => {
  assert.strictEqual(match.evaluarCandidata(apto({ zona: "Robledo" }), pide({ zona: "Barrio Mesa" }), "diamond"), null);
  // Otro barrio de Envigado tampoco: la propiedad dice su barrio, y no es el pedido.
  assert.strictEqual(
    match.evaluarCandidata(apto({ zona: "Las Antillas", ciudad: "Envigado" }), pide({ zona: "Barrio Mesa" }), "diamond"),
    null
  );
});

test("El Poblado no se come Envigado: su vecindad es con el municipio, no con cada barrio", () => {
  assert.strictEqual(match.evaluarCandidata(apto({ zona: "Barrio Mesa" }), pide({ zona: "El Poblado" }), "diamond"), null);
});

test("una vecindad ya declarada conserva su grado: San Joaquin contra Laureles sigue siendo vecina", () => {
  const m = match.evaluarCandidata(apto({ zona: "Laureles", ciudad: "Medellín" }), pide({ zona: "San Joaquín" }), "diamond");
  assert.ok(m);
  assert.strictEqual(m.ubicacion, "vecina");
});

// ── Lo que sale ───────────────────────────────────────────────────────────

test("zona_general se puede ofrecer: la compuerta de publicacion no la frena por zona", () => {
  const m = match.evaluarCandidata(apto(), pide({ zona: "Barrio Mesa" }), "diamond");
  const { motivos } = publicable.esPublicable(m, { umbral: 0, syncFresco: true });
  assert.ok(!motivos.includes("zona_no_publicable"), motivos.join(","));
});

test("la ficha al colega dice donde queda y que el barrio no lo tenemos, sin sonar a objecion", () => {
  const m = match.evaluarCandidata(apto(), pide({ zona: "Barrio Mesa" }), "diamond");
  const d = redactar.desvios(m, pide({ zona: "Barrio Mesa" }));
  assert.ok(d.includes("queda en Envigado; el barrio exacto no lo tengo registrado"), d.join(" | "));
  assert.ok(!d.some((x) => /no en Barrio Mesa/.test(x)), "no es 'queda en otro lado'");
});
