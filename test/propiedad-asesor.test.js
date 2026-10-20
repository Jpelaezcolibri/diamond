// test/propiedad-asesor.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const pa = require("../src/lib/propiedad-asesor");

const COMPLETO = {
  operacion: "arriendo", tipo: "apartamento", barrio: "Laureles", municipio: "Medellín",
  precio: "4.500.000", periodo: "mensual", amoblado: true, area: "60", alcobas: 2, banos: 2,
  parqueaderos: 1, estrato: 5, administracion: "350.000", descripcion: "Cerca a la 70",
};

test("datos completos: fila lista y sin faltantes", () => {
  const { fila, faltantes } = pa.normalizar(COMPLETO);
  assert.deepStrictEqual(faltantes, []);
  assert.strictEqual(fila.operacion, "Arriendo");
  assert.strictEqual(fila.tipo, "Apartamento");
  assert.strictEqual(fila.precio, "$4.500.000");
  assert.strictEqual(fila.area, "60m2");
  assert.strictEqual(fila.zona, "Laureles");
  assert.strictEqual(fila.ciudad, "Medellín");
  assert.strictEqual(fila.periodo_precio, "mensual");
  assert.strictEqual(fila.caracteristicas, "Amoblado");
  assert.strictEqual(fila.administracion, "$350.000");
  assert.strictEqual(fila.titulo, "Apartamento amoblado en arriendo en Laureles");
});

test("faltantes: dice exactamente que falta", () => {
  const { faltantes } = pa.normalizar({ operacion: "arriendo", tipo: "casa" });
  for (const f of ["barrio o sector", "municipio", "precio (en números)", "si el canon es mensual o por noche", "si está amoblado", "área en m²", "alcobas", "baños"]) {
    assert.ok(faltantes.includes(f), `falta "${f}" en ${JSON.stringify(faltantes)}`);
  }
});

test("venta no pide periodo ni amoblado; local no pide alcobas", () => {
  const { faltantes, fila } = pa.normalizar({ operacion: "venta", tipo: "local", barrio: "Centro", municipio: "Medellín", precio: "450 millones", area: "80" });
  assert.deepStrictEqual(faltantes, []);
  assert.strictEqual(fila.precio, "$450.000.000");
  assert.strictEqual(fila.periodo_precio, null);
  assert.strictEqual(fila.titulo, "Local en venta en Centro");
});

test("precio y area que no cuadran cuentan como faltantes", () => {
  const { faltantes } = pa.normalizar({ ...COMPLETO, precio: "barato", area: "0" });
  assert.ok(faltantes.includes("precio (en números)"));
  assert.ok(faltantes.includes("área en m²"));
});

test("casa amoblada concuerda en genero y el periodo por noche se lee", () => {
  const { fila } = pa.normalizar({ ...COMPLETO, tipo: "casa", periodo: "por noche" });
  assert.strictEqual(fila.titulo, "Casa amoblada en arriendo en Laureles");
  assert.strictEqual(fila.periodo_precio, "diario");
});

test("token cambia si cambian los datos o las fotos", () => {
  const { fila } = pa.normalizar(COMPLETO);
  const t = pa.tokenDe(fila, ["a.jpg"]);
  assert.match(t, /^[0-9a-f]{12}$/);
  assert.strictEqual(pa.tokenDe(fila, ["a.jpg"]), t);
  assert.notStrictEqual(pa.tokenDe(fila, ["a.jpg", "b.jpg"]), t);
  assert.notStrictEqual(pa.tokenDe({ ...fila, precio: "$1" }, ["a.jpg"]), t);
});

test("siguienteRef arranca en D1001 y sigue el mayor", () => {
  assert.strictEqual(pa.siguienteRef([]), "D1001");
  assert.strictEqual(pa.siguienteRef(["D1001", "d1007", "10383517", "D10x"]), "D1008");
});
