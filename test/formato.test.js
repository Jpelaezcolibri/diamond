// Formato de valores para humanos. Los casos no son inventados: cada uno sale
// de un dato real de la base o de un bug encontrado en la auditoria del
// 2026-08-16, cuando se evaluo publicar automaticamente en grupos gremiales.

const { test } = require("node:test");
const assert = require("node:assert");
const f = require("../src/lib/formato");

test("el precio no concatena todos los digitos del texto", () => {
  // El bug: `replace(/\D/g,"")` sobre este label devolvia 4500000002024 — diez
  // mil veces el precio real, sin fallar. Se toma el primer grupo numerico.
  assert.strictEqual(f.parsearPrecio("$450.000.000 negociable 2024"), 450000000);
  assert.strictEqual(f.parsearPrecio("$820.000.000"), 820000000);
  assert.strictEqual(f.parsearPrecio("COP 2.200.000"), 2200000);
});

test("un precio en $0 no es un precio", () => {
  // Wasi devuelve "$0" cuando el label quedo sin llenar. Devolver 0 era peor
  // que devolver null: 0 es falsy, asi que la propiedad se colaba por el filtro
  // de presupuesto y se ofrecia sin linea de precio.
  assert.strictEqual(f.parsearPrecio("$0"), null);
  assert.strictEqual(f.parsearPrecio("0"), null);
  assert.strictEqual(f.parsearPrecio(0), null);
  assert.strictEqual(f.formatearPrecio("$0"), null);
});

test("texto sin numeros o vacio devuelve null, no NaN", () => {
  assert.strictEqual(f.parsearPrecio("Precio a convenir"), null);
  assert.strictEqual(f.parsearPrecio(""), null);
  assert.strictEqual(f.parsearPrecio(null), null);
  assert.strictEqual(f.parsearPrecio(undefined), null);
});

test("'1.200 millones' se entiende como mil doscientos millones", () => {
  // Asi lo escribe la gente en los grupos. Sin esto se leia como $1.200.
  assert.strictEqual(f.parsearPrecio("1.200 millones"), 1200000000);
  assert.strictEqual(f.parsearPrecio("800 millones"), 800000000);
  // Un label ya expandido no se multiplica de nuevo.
  assert.strictEqual(f.parsearPrecio("$1.200.000.000"), 1200000000);
});

test("el precio se formatea en pesos colombianos", () => {
  assert.strictEqual(f.formatearPrecio(820000000), "$820.000.000");
  assert.strictEqual(f.formatearPrecio("$820.000.000"), "$820.000.000");
});

test("la version corta distingue millones de miles de millones", () => {
  // match.js usaba millones() y renderizaba $1.550.000.000 como "$1550M".
  assert.strictEqual(f.formatearPrecioCorto(820000000), "$820M");
  assert.strictEqual(f.formatearPrecioCorto(1550000000), "$1.6MM");
  assert.strictEqual(f.formatearPrecioCorto(2000000000), "$2MM");
});

test("el area acepta el formato pegado de Wasi y sale legible", () => {
  assert.strictEqual(f.parsearArea("186m2"), 186);
  assert.strictEqual(f.parsearArea("210 m²"), 210);
  assert.strictEqual(f.parsearArea("10,5m2"), 10.5);
  assert.strictEqual(f.formatearArea("186m2"), "186 m²");
  assert.strictEqual(f.formatearArea("10,5m2"), "10,5 m²");
  assert.strictEqual(f.parsearArea(""), null);
  assert.strictEqual(f.formatearArea(null), null);
});

test("una alcoba, no '1 alcobas'", () => {
  assert.strictEqual(f.pluralizar(1, "alcoba"), "1 alcoba");
  assert.strictEqual(f.pluralizar(4, "alcoba"), "4 alcobas");
  assert.strictEqual(f.pluralizar(1, "baño"), "1 baño");
  assert.strictEqual(f.pluralizar(2, "baño"), "2 baños");
  // Cero o ausente no se menciona: "0 alcobas" no aporta nada.
  assert.strictEqual(f.pluralizar(0, "alcoba"), null);
  assert.strictEqual(f.pluralizar(null, "alcoba"), null);
});

test("el titulo deja de gritar y pierde los espacios dobles", () => {
  // Titulo real de la base, con doble espacio incluido.
  assert.strictEqual(
    f.normalizarTitulo("VENDO DUPLEX  FRENTE AL VIVA LAURELES"),
    "Vendo Duplex Frente al Viva Laureles"
  );
  assert.strictEqual(f.normalizarTitulo("CASA EN VENTA EN LA ESTRELLA"), "Casa en Venta en la Estrella");
});

test("un titulo bien escrito no se toca", () => {
  // Sin esto, las siglas y los nombres propios se destruian.
  const bueno = "Apartamento en Venta Envigado - Cerca al Metro";
  assert.strictEqual(f.normalizarTitulo(bueno), bueno);
  assert.strictEqual(f.normalizarTitulo("  Casa   campestre  "), "Casa campestre");
  assert.strictEqual(f.normalizarTitulo(""), null);
  assert.strictEqual(f.normalizarTitulo(null), null);
});
