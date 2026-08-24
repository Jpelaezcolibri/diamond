// Rama real (Supabase) de src/data/colegas.js — la rama en memoria ya la
// cubre test/colegas-data.test.js. Esto protege el fix del 2026-08-24
// (revision final de fase1-directorio-colegas, Juan):
//
//   · porTelefono ya NO trae la tabla completa (select + not(is null) sin
//     limit) para filtrar en JS con mismoTelefono. PostgREST corta eso en
//     1.000 filas por defecto y el diseño apunta a ~1.012 colegas: pasado ese
//     numero habia colegas que nunca se reconocian, sin ningun aviso. Ahora
//     consulta por las variantes EXACTAS del numero (con/sin indicativo),
//     que es lo que de verdad usa el indice parcial idx_colegas_grupos_telefono.
//   · listarConTelefono (semilla del indice del directorio) tenia el mismo
//     truncamiento silencioso. Ahora pagina con .range() hasta traer todo.

const { test } = require("node:test");
const assert = require("node:assert");

// src/data/supabase.js NO crea el cliente real bajo test (guard 2026-08-24,
// ver ese archivo). Este archivo SI necesita un cliente truthy para poder
// mockear su metodo from() por tabla, asi que se inyecta un doble en el
// cache del modulo antes de cargar colegas.js — mismo patron que
// test/colegas-data.test.js y test/directorio.test.js usan para forzar null.
const supabasePath = require.resolve("../src/data/supabase");
delete require.cache[supabasePath];
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: { from: () => { throw new Error("from() sin mockear en este test"); } },
};

const colegas = require("../src/data/colegas");
const supabase = require("../src/data/supabase");

const ORG = "org-real-1";

test("porTelefono consulta por variantes exactas (con y sin indicativo), no trae la tabla completa", async (t) => {
  const llamadas = [];

  t.mock.method(supabase, "from", (tabla) => {
    assert.strictEqual(tabla, "colegas_grupos");
    const c = {
      select: () => c,
      eq: (col, val) => { llamadas.push({ metodo: "eq", col, val }); return c; },
      in: (col, valores) => { llamadas.push({ metodo: "in", col, valores }); return c; },
      not: (col, op, val) => { llamadas.push({ metodo: "not", col, op, val }); return c; },
      limit: (n) => {
        llamadas.push({ metodo: "limit", n });
        // El colega esta guardado SIN indicativo (10 digitos) — el caso que
        // antes se perdia si alguien buscaba comparando con mismoTelefono en
        // JS pero la query en la base pedia una igualdad exacta.
        return Promise.resolve({
          data: [{ lid: "111", telefono: "3001234567", nombre: "Esteban" }],
          error: null,
        });
      },
    };
    return c;
  });

  const fila = await colegas.porTelefono(ORG, "573001234567");
  assert.ok(fila, "deberia encontrarlo aunque la base lo tenga guardado sin indicativo");
  assert.strictEqual(fila.lid, "111");

  // La query real: eq(org_id) + in(telefono, variantes) + limit. Sin ningun
  // not("telefono","is",null) sin filtro de igualdad — eso es exactamente lo
  // que traia la tabla entera.
  assert.ok(llamadas.some((l) => l.metodo === "eq" && l.col === "org_id" && l.val === ORG));
  const inTelefono = llamadas.find((l) => l.metodo === "in" && l.col === "telefono");
  assert.ok(inTelefono, "porTelefono debe filtrar por telefono en la base, no en memoria");
  assert.ok(
    inTelefono.valores.includes("573001234567") && inTelefono.valores.includes("3001234567"),
    `las variantes deberian incluir el numero tal cual y sin indicativo, vinieron: ${inTelefono.valores}`
  );
  assert.ok(
    !llamadas.some((l) => l.metodo === "not"),
    "no deberia quedar ningun filtro not(telefono, is, null) sin acotar por igualdad: eso es el select de la tabla completa"
  );
});

test("porTelefono no encuentra nada si ninguna variante calza (y no revienta)", async (t) => {
  t.mock.method(supabase, "from", () => ({
    select() { return this; },
    eq() { return this; },
    in() { return this; },
    limit: () => Promise.resolve({ data: [], error: null }),
  }));

  const fila = await colegas.porTelefono(ORG, "573009999999");
  assert.strictEqual(fila, null);
});

test("listarConTelefono pagina mas alla de 1.000 filas en vez de truncar en silencio", async (t) => {
  const TOTAL = 1500;
  const todas = Array.from({ length: TOTAL }, (_, i) => ({
    lid: `lid-${i}`, telefono: `30012${String(i).padStart(5, "0")}`, nombre: null,
  }));

  const rangos = [];
  t.mock.method(supabase, "from", () => {
    const c = {
      select: () => c,
      eq: () => c,
      not: () => c,
      order: () => c,
      range: (desde, hasta) => {
        rangos.push([desde, hasta]);
        return Promise.resolve({ data: todas.slice(desde, hasta + 1), error: null });
      },
    };
    return c;
  });

  const resultado = await colegas.listarConTelefono(ORG);
  assert.strictEqual(resultado.length, TOTAL, "debe traer TODOS los colegas, no cortar en 1.000");
  assert.deepStrictEqual(rangos, [[0, 999], [1000, 1999]], "debe pedir la segunda pagina hasta que una vuelva incompleta");
});

test("listarConTelefono no pide una pagina de mas cuando el total es multiplo exacto del tamano de pagina", async (t) => {
  const TOTAL = 1000; // exactamente una pagina llena
  const todas = Array.from({ length: TOTAL }, (_, i) => ({ lid: `lid-${i}`, telefono: `300${i}`, nombre: null }));

  let llamadasRange = 0;
  t.mock.method(supabase, "from", () => {
    const c = {
      select: () => c,
      eq: () => c,
      not: () => c,
      order: () => c,
      range: (desde, hasta) => {
        llamadasRange += 1;
        return Promise.resolve({ data: todas.slice(desde, hasta + 1), error: null });
      },
    };
    return c;
  });

  const resultado = await colegas.listarConTelefono(ORG);
  assert.strictEqual(resultado.length, TOTAL);
  assert.strictEqual(llamadasRange, 2, "la pagina llena no basta para saber que termino: hace falta una vuelta vacia");
});
