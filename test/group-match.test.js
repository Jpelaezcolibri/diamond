const { test } = require("node:test");
const assert = require("node:assert");
const { filtrosInventario, filtrosAliados, mismaOperacion, evaluarOferta } = require("../src/groups/match");

const demanda = {
  clase: "demanda", operacion: "venta", tipo: "apartamento", zona: "Laureles",
  precio_max: 400000000, precio_min: 0, habitaciones: 3,
};

// ── Traducción de claves ─────────────────────────────────────────────────

test("BUG: properties usa precio_max y ally-properties usa precioMax", () => {
  // Sin traducir, el filtro de precio se ignora en silencio en una de las dos
  // fuentes y TODO parece matchear — que es justo lo que haría pasar la
  // compuerta de negocio por la razón equivocada.
  assert.strictEqual(filtrosInventario(demanda).precio_max, 400000000);
  assert.strictEqual(filtrosInventario(demanda).precioMax, undefined);

  assert.strictEqual(filtrosAliados(demanda).precioMax, 400000000);
  assert.strictEqual(filtrosAliados(demanda).precio_max, undefined);
});

test("las habitaciones van como habitaciones_min al inventario propio", () => {
  assert.strictEqual(filtrosInventario(demanda).habitaciones_min, 3);
});

test("los campos vacíos o en cero no se mandan como filtro", () => {
  // Un precio_max: 0 filtraría todo el inventario a nada.
  const sinDatos = { operacion: "", tipo: "", zona: "", precio_max: 0, precio_min: 0, habitaciones: 0 };
  assert.deepStrictEqual(filtrosInventario(sinDatos), {});
  assert.deepStrictEqual(filtrosAliados(sinDatos), {});
});

test("la operación NO se manda a ally-properties (su comparación es estricta)", () => {
  // ally-properties.matchesFilters compara con !== estricto y la tabla guarda
  // lo que extrajo Claude en su momento ("Venta" / "venta"). Se filtra aparte.
  assert.strictEqual(filtrosAliados(demanda).operacion, undefined);
});

// ── Operación ────────────────────────────────────────────────────────────

test("BUG: una demanda de arriendo no debe matchear propiedades en venta", () => {
  // properties.search() no filtra por operacion; sin este filtro la métrica de
  // negocio de la Fase 0 se infla y la compuerta pasa por la razón equivocada.
  const arriendo = { ...demanda, operacion: "arriendo" };
  assert.strictEqual(mismaOperacion({ operacion: "Venta" }, arriendo), false);
  assert.strictEqual(mismaOperacion({ operacion: "Arriendo" }, arriendo), true);
});

test("la comparación de operación ignora mayúsculas y espacios", () => {
  assert.strictEqual(mismaOperacion({ operacion: "  VENTA " }, demanda), true);
});

test("sin operación en el pedido no se descarta nada", () => {
  // Preferimos un falso positivo (barato, lo revisa el asesor) antes que
  // perder un negocio por un dato que el colega no escribió.
  const sinOperacion = { ...demanda, operacion: "" };
  assert.strictEqual(mismaOperacion({ operacion: "Arriendo" }, sinOperacion), true);
  assert.strictEqual(mismaOperacion({ operacion: "Venta" }, sinOperacion), true);
});

test("una propiedad sin operación registrada no se descarta", () => {
  assert.strictEqual(mismaOperacion({ operacion: null }, demanda), true);
});

// ── Ofertas ──────────────────────────────────────────────────────────────

const oferta = {
  clase: "oferta", operacion: "venta", tipo: "casa", zona: "Sabaneta",
  precio_max: 650000000, precio_min: 0, contacto: "", notas: "3 alcobas",
  mensaje: { autor: "Diana Vélez", texto: "Se vende casa en Sabaneta" },
};

test("una oferta completa es utilizable", () => {
  const r = evaluarOferta(oferta);
  assert.strictEqual(r.utilizable, true);
  assert.deepStrictEqual(r.faltantes, []);
});

test("una oferta sin precio ni zona dice exactamente qué le falta", () => {
  const r = evaluarOferta({ ...oferta, precio_max: 0, zona: "" });
  assert.strictEqual(r.utilizable, false);
  assert.deepStrictEqual(r.faltantes, ["zona", "precio"]);
});

test("el autor del mensaje cuenta como contacto", () => {
  // En vivo el remitente de WhatsApp siempre aporta el teléfono; exigir el
  // contacto del texto subestimaría el rendimiento real del sistema.
  const r = evaluarOferta({ ...oferta, contacto: "" });
  assert.strictEqual(r.faltantes.includes("contacto"), false);
  assert.strictEqual(r.propuesta.contacto_nombre, "Diana Vélez");
});

test("sin autor ni contacto sí falta el contacto", () => {
  const r = evaluarOferta({ ...oferta, contacto: "", mensaje: { autor: null, texto: "x" } });
  assert.deepStrictEqual(r.faltantes, ["contacto"]);
});

test("la propuesta tiene el shape de ally-properties.create y conserva el original", () => {
  const r = evaluarOferta(oferta);
  assert.strictEqual(r.propuesta.tipo, "casa");
  assert.strictEqual(r.propuesta.precio, 650000000);
  assert.strictEqual(r.propuesta.mensaje_original, "Se vende casa en Sabaneta");
});

test("un precio que sólo viene como mínimo también sirve", () => {
  const r = evaluarOferta({ ...oferta, precio_max: 0, precio_min: 500000000 });
  assert.strictEqual(r.utilizable, true);
  assert.strictEqual(r.propuesta.precio, 500000000);
});
