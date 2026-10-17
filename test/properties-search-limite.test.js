const { test } = require("node:test");
const assert = require("node:assert");
const path = require("path");

// BUG real (2026-10-17). properties.search pedia a la base `limit * 2` filas
// SIN filtrar operacion y recien despues filtraba el precio en codigo (precio
// es texto). Un pedido de arriendo amoblado en El Poblado por $7M traia 60
// apartamentos en VENTA del Poblado, el filtro de precio los borraba a todos y
// la 10383517 (arriendo, El Poblado, $6,8M, puntaje 100) nunca llegaba al
// motor. Lo mismo le pasa a una venta barata en una zona con muchas caras.

// Base falsa: aplica los filtros que el codigo le pide (eq/ilike/gte/or) y
// respeta el limit, que es justo donde estaba el bug.
function baseFalsa(filas) {
  return {
    from() {
      const filtros = [];
      let tope = Infinity;
      const q = {
        select() { return q; },
        eq(col, v) { filtros.push((p) => p[col] === v); return q; },
        ilike(col, patron) {
          const re = new RegExp("^" + String(patron).replace(/%/g, ".*") + "$", "i");
          filtros.push((p) => re.test(String(p[col] ?? "")));
          return q;
        },
        gte(col, v) { filtros.push((p) => Number(p[col]) >= v); return q; },
        or() { return q; },
        limit(n) { tope = n; return q; },
        then(resolve) {
          resolve({ data: filas.filter((p) => filtros.every((f) => f(p))).slice(0, tope), error: null });
        },
      };
      return q;
    },
  };
}

const venta = (i) => ({
  id: `v${i}`, org_id: "org", ref: `V${i}`, titulo: `Apto venta ${i}`, tipo: "Apartamento", operacion: "Venta",
  precio: "$900.000.000", zona: "El Poblado", ciudad: "Medellín", habitaciones: 2, disponible: true, link: null,
});
const arriendo = {
  id: "a1", org_id: "org", ref: "10383517", titulo: "Amoblado en renta El Poblado", tipo: "Apartamento",
  operacion: "Arriendo", precio: "$6.800.000", zona: "El Poblado", ciudad: "Medellín", habitaciones: 2,
  disponible: true, link: null,
};

function cargarConBase(filas) {
  const rutaSupabase = path.resolve(__dirname, "../src/data/supabase.js");
  const rutaProps = path.resolve(__dirname, "../src/data/properties.js");
  delete require.cache[rutaProps];
  require.cache[rutaSupabase] = { id: rutaSupabase, filename: rutaSupabase, loaded: true, exports: baseFalsa(filas) };
  const props = require(rutaProps);
  delete require.cache[rutaSupabase];
  delete require.cache[rutaProps];
  return props;
}

const ORG = { id: "org", landing_base_url: "https://diamondinmobiliaria.com" };

test("BUG: un arriendo barato no queda tapado por 60 ventas caras de la misma zona", async () => {
  const filas = [...Array.from({ length: 80 }, (_, i) => venta(i)), arriendo];
  const props = cargarConBase(filas);
  const r = await props.search(ORG, { zona: "poblado", tipo: "apartamento", precio_max: 7700000, operacion: "arriendo" }, 30);
  assert.deepStrictEqual(r.map((p) => p.ref), ["10383517"]);
});

test("BUG: sin operacion, el precio igual se filtra sobre TODAS las filas, no sobre las primeras 60", async () => {
  const filas = [...Array.from({ length: 80 }, (_, i) => venta(i)), arriendo];
  const props = cargarConBase(filas);
  const r = await props.search(ORG, { zona: "poblado", tipo: "apartamento", precio_max: 7700000 }, 30);
  assert.deepStrictEqual(r.map((p) => p.ref), ["10383517"]);
});

test("la operacion filtra: una venta no le sale a un pedido de arriendo", async () => {
  const props = cargarConBase([venta(1), arriendo]);
  const r = await props.search(ORG, { zona: "poblado", operacion: "venta" }, 30);
  assert.deepStrictEqual(r.map((p) => p.ref), ["V1"]);
});

test("el motor de grupos le pasa la operacion al prefiltro", () => {
  const { filtrosInventario } = require("../src/groups/match");
  assert.strictEqual(filtrosInventario({ operacion: "arriendo", zona: "El Poblado" }).operacion, "arriendo");
  assert.strictEqual(filtrosInventario({ operacion: "Venta", zona: "El Poblado" }).operacion, "venta");
  assert.strictEqual(filtrosInventario({ operacion: "permuta", zona: "El Poblado" }).operacion, undefined);
  assert.strictEqual(filtrosInventario({ zona: "El Poblado" }).operacion, undefined);
});
