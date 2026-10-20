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

// --- Fix round 1: lo ambiguo es faltante, nunca un valor equivocado ---
const precioDe = (p) => pa.normalizar({ ...COMPLETO, precio: p });

test("precios claros se leen exactos", () => {
  assert.strictEqual(precioDe("1.200 millones").fila.precio, "$1.200.000.000");
  assert.strictEqual(precioDe("1.200millones").fila.precio, "$1.200.000.000");
  assert.strictEqual(precioDe("1.5 millones").fila.precio, "$1.500.000");
  assert.strictEqual(precioDe("4,5 millones").fila.precio, "$4.500.000");
  assert.strictEqual(precioDe("450 millones").fila.precio, "$450.000.000");
  assert.strictEqual(precioDe("850 mil").fila.precio, "$850.000");
  assert.strictEqual(precioDe("$ 4500000").fila.precio, "$4.500.000");
});

test("precios ambiguos cuentan como faltante", () => {
  for (const p of ["4.500.000 + admin 350.000", "4.500.000,50", "2mm", "dos millones"]) {
    const { fila, faltantes } = precioDe(p);
    assert.strictEqual(fila.precio, null, p);
    assert.ok(faltantes.includes("precio (en números)"), p);
  }
});

test("area: miles, unidad y rangos", () => {
  assert.strictEqual(pa.normalizar({ ...COMPLETO, area: "1.200" }).fila.area, "1200m2");
  assert.strictEqual(pa.normalizar({ ...COMPLETO, area: "85 m2" }).fila.area, "85m2");
  const r = pa.normalizar({ ...COMPLETO, area: "60-80" });
  assert.strictEqual(r.fila.area, null);
  assert.ok(r.faltantes.includes("área en m²"));
});

test("alcobas booleano, operacion y periodo ambiguos son faltantes", () => {
  assert.ok(pa.normalizar({ ...COMPLETO, alcobas: true }).faltantes.includes("alcobas"));
  assert.ok(pa.normalizar({ ...COMPLETO, operacion: "se vende o arrienda" }).faltantes.includes("operación (venta o arriendo)"));
  assert.ok(pa.normalizar({ ...COMPLETO, periodo: "mensual o diario" }).faltantes.includes("si el canon es mensual o por noche"));
});

test("enteros dichos como texto se leen", () => {
  const { fila, faltantes } = pa.normalizar({ ...COMPLETO, alcobas: "2", banos: "1", parqueaderos: "1", estrato: "4" });
  assert.deepStrictEqual(faltantes, []);
  assert.deepStrictEqual([fila.habitaciones, fila.banos, fila.garaje, fila.estrato], [2, 1, 1, 4]);
});

test("M7: un precio por noche como '90 mil' es valido con periodo diario", () => {
  const { fila, faltantes } = pa.normalizar({
    operacion: "arriendo", tipo: "apartamento", barrio: "Laureles", municipio: "Medellín", precio: "90 mil",
    periodo: "por noche", amoblado: true, area: "50", alcobas: 1, banos: 1,
  });
  assert.ok(!faltantes.includes("precio (en números)"));
  assert.equal(fila.periodo_precio, "diario");
});
