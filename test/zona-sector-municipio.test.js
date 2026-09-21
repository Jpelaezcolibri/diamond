// El sector restringe, el municipio contiene (Juan, 2026-09-21).
//
// EL CASO. Un colega pidio "*PROPIEDAD EN ENVIGADO!* · Sector: UNIDAD CAMINO DE
// LAS AGUAS · desde 75 m² · 3 habitaciones · hasta $470 millones" y recibio por
// DM la ref 10077063, "VENDO APARTAMENTO ENVIGADO BARRIO MESA". Contesto: "Te
// sugiero ajustes el Bot, para que el Match tenga un % mayor de acertividad".
// El mismo pedido habia llegado dos veces el 20-sep (Chacon Bienes) y las dos
// veces salio la misma ref.
//
// LA CADENA. El clasificador tenia la orden de poner "el barrio Y el
// municipio" juntos en `zonas` -> ["Envigado", "Camino de las Aguas"]. El motor
// lee `zonas` como alternativas ("Envigado O Camino de las Aguas"), asi que
// "Envigado" solo ya calzaba EXACTA con cualquier propiedad del municipio:
// puntaje 100 y ninguna salvedad. El DM lo repitio: "tu pedido ... en Envigado
// o Camino de las Aguas".
//
// EL ARREGLO. El municipio que CONTIENE al sector va en un campo propio,
// `zona_madre`, y `zonas` queda solo con lo que restringe. Una propiedad
// registrada solo con el municipio es `zona_general` (sector sin confirmar), y
// eso ya no sale sola: decision de Juan del mismo dia, "literal: no sale sola",
// la misma regla del 18-sep para la zona vecina.
const { test } = require("node:test");
const assert = require("node:assert");
const match = require("../src/groups/match");
const publicable = require("../src/groups/publicable");
const { ESQUEMA, SISTEMA } = require("../src/groups/classify");

const pide = (extra = {}) => ({
  tipo: "apartamento", operacion: "venta", zona: null, zonas: [], zona_madre: "", ciudad: null,
  habitaciones: 3, precio_max: 470000000, area_min: 75, ...extra,
});
const mesa = (extra = {}) => ({
  ref: "10077063", titulo: "VENDO APARTAMENTO ENVIGADO BARRIO MESA PERMITE RENTAS CORTAS", tipo: "Apartamento",
  operacion: "Venta", precio: "$450.000.000", zona: "Envigado", ciudad: "Medellín",
  habitaciones: 3, banos: 2, garaje: 0, estrato: 3, area: "83m2",
  link: "https://diamondinmobiliaria.com/propiedades/x-10077063", ...extra,
});
// Lo que devuelve el clasificador despues del arreglo para el pedido real.
const caminoDeLasAguas = () => pide({ zona: "Camino de las Aguas", zonas: ["Camino de las Aguas"], zona_madre: "Envigado" });

// ── El clasificador ───────────────────────────────────────────────────────

test("el esquema tiene zona_madre, obligatoria, separada de zonas", () => {
  const props = ESQUEMA.properties.mensajes.items.properties;
  const required = ESQUEMA.properties.mensajes.items.required;
  assert.strictEqual(props.zona_madre.type, "string");
  assert.ok(required.includes("zona_madre"), "si no es required, el modelo la omite");
});

test("el prompt ya no manda poner el barrio y el municipio juntos en zonas", () => {
  // Esta era la orden que armaba ["Envigado","Camino de las Aguas"].
  assert.doesNotMatch(SISTEMA, /van los dos: \["Camino Verde","Envigado"\]/);
});

test("el prompt enseña el caso real: municipio que contiene al sector", () => {
  assert.match(SISTEMA, /zona_madre/);
  assert.match(SISTEMA, /Camino de las Aguas/, "el ejemplo tiene que ser el pedido que fallo");
  // Y lo distingue de las alternativas, que siguen siendo una lista sin madre.
  assert.match(SISTEMA, /POBLADO\/ENVIGADO/);
});

// ── El motor ──────────────────────────────────────────────────────────────

test("EL CASO: la 10077063 ya no es exacta para un pedido de Camino de las Aguas", () => {
  const m = match.evaluarCandidata(mesa(), caminoDeLasAguas(), "diamond");
  assert.ok(m, "tiene que quedar visible en /grupos, no desaparecer");
  assert.strictEqual(m.ubicacion, "zona_general");
});

test("una propiedad EN Camino de las Aguas sigue siendo exacta", () => {
  const m = match.evaluarCandidata(mesa({ ref: "X1", zona: "Camino de las Aguas", ciudad: "Envigado" }), caminoDeLasAguas(), "diamond");
  assert.ok(m);
  assert.strictEqual(m.ubicacion, "exacta");
});

test("si el modelo igual repite el municipio en zonas, el motor no lo usa como alternativa", () => {
  const c = pide({ zona: "Envigado", zonas: ["Envigado", "Camino de las Aguas"], zona_madre: "Envigado" });
  const m = match.evaluarCandidata(mesa(), c, "diamond");
  assert.ok(m);
  assert.strictEqual(m.ubicacion, "zona_general");
});

test("las alternativas de verdad no cambian: El Poblado o Envigado sigue calzando Envigado", () => {
  const c = pide({ zona: "El Poblado", zonas: ["El Poblado", "Envigado"], zona_madre: "" });
  const m = match.evaluarCandidata(mesa(), c, "diamond");
  assert.ok(m);
  assert.strictEqual(m.ubicacion, "exacta");
});

test("un pedido de solo Envigado (madre y nada mas) sigue siendo de Envigado", () => {
  const c = pide({ zona: "Envigado", zonas: ["Envigado"], zona_madre: "Envigado" });
  const m = match.evaluarCandidata(mesa(), c, "diamond");
  assert.ok(m);
  assert.strictEqual(m.ubicacion, "exacta");
});

test("la consulta trae las propiedades del municipio madre, para poder graduarlas", () => {
  const t = String(match.filtrosInventario(caminoDeLasAguas()).zona || "").split(" ");
  assert.ok(t.includes("envigado"), t.join(" "));
});

// ── Lo que sale ───────────────────────────────────────────────────────────

test("zona_general no sale sola: motivo sector_sin_confirmar", () => {
  const m = match.evaluarCandidata(mesa(), caminoDeLasAguas(), "diamond");
  const v = publicable.esPublicable(m, { umbral: 0, syncFresco: true });
  assert.strictEqual(v.ok, false);
  assert.ok(v.motivos.includes("sector_sin_confirmar"), v.motivos.join(","));
});

test("sector_sin_confirmar solo frena la publicacion: la asesora la puede ofrecer", () => {
  const { ofrecible } = publicable.clasificarMotivos(["sector_sin_confirmar"]);
  assert.strictEqual(ofrecible, true);
});

test("sector_sin_confirmar se traduce a algo que una persona pueda accionar", () => {
  const texto = publicable.explicarMotivosSeguro(["sector_sin_confirmar"]);
  assert.ok(texto);
  assert.match(texto, /sector|barrio/i);
});

test("el caso real completo: la 10077063 no le sale a Emprende con Edwin", () => {
  const m = match.evaluarCandidata(mesa(), caminoDeLasAguas(), "diamond");
  assert.ok(m, "sin match no se prueba la compuerta: se prueba que desaparecio");
  const { publicables, descartados } = publicable.filtrar([m], { umbral: 0 });
  assert.deepStrictEqual(publicables, []);
  assert.ok(descartados[0].motivos.includes("sector_sin_confirmar"), descartados[0].motivos.join(","));
});
