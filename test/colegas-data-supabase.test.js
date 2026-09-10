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

// ── upsert: carrera del unique(org_id, lid) y fallos reales ───────────────
//
// Un colega difunde el mismo pedido a varios grupos y la cola del radar es
// POR GRUPO (src/groups/vivo.js): dos mensajes del mismo colega se procesan
// en paralelo, los dos ven "no existe" en el SELECT antes de que cualquiera
// termine el INSERT, y el segundo INSERT choca con el unique. Antes eso caia
// en un catch generico: console.warn y la fila se perdia sin rastro.

test("upsert reintenta si el insert choca con la carrera del unique(org_id, lid), y termina actualizando", async (t) => {
  let selects = 0;
  let intentosInsert = 0;
  let updates = 0;
  let filaCreadaPorElOtroProceso = null;

  t.mock.method(supabase, "from", () => {
    const c = {
      select: () => c,
      eq: () => c,
      maybeSingle: () => {
        selects += 1;
        // 1a vuelta (antes del insert): no existe todavia. 2a vuelta (tras el
        // 23505): ya existe, la creo el proceso paralelo que gano la carrera.
        return Promise.resolve({ data: selects === 1 ? null : filaCreadaPorElOtroProceso, error: null });
      },
      insert: (fila) => {
        intentosInsert += 1;
        filaCreadaPorElOtroProceso = { id: "fila-ganadora", telefono: fila.telefono, nombre: fila.nombre, grupos: fila.grupos };
        return Promise.resolve({ error: { code: "23505", message: "duplicate key value violates unique constraint" } });
      },
      update: () => ({
        eq: () => { updates += 1; return Promise.resolve({ error: null }); },
      }),
    };
    return c;
  });

  const guardado = await colegas.upsert("org-1", {
    lid: "111222333", telefono: "573001112233", nombre: "Ana", grupo: "SOLO POBLADO",
  });

  assert.strictEqual(guardado, true, "el reintento deberia terminar guardando la fila");
  assert.strictEqual(intentosInsert, 1, "no debe insistir con un segundo insert: la segunda pasada actualiza, no reinserta");
  assert.strictEqual(updates, 1);
  assert.strictEqual(selects, 2, "un select antes del insert, y otro tras el 23505 para encontrar la fila que ya existe");
});

test("upsert no reintenta infinito: un 23505 persistente (no una carrera real) se propaga como fallo, no como exito", async (t) => {
  // Silenciado (Juan, 2026-09-10): este 23505 persistente SI cae en el
  // console.error real de upsert (no es una migracion pendiente, es un fallo
  // de escritura) — sin silenciar, `npm test` deja este log suelto en una
  // corrida en verde.
  const original = console.error;
  console.error = () => {};

  t.mock.method(supabase, "from", () => ({
    select() { return this; },
    eq() { return this; },
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    insert: () => Promise.resolve({ error: { code: "23505", message: "duplicate key value violates unique constraint" } }),
  }));

  try {
    const guardado = await colegas.upsert("org-1", { lid: "444555666", telefono: "573004445566" });
    assert.strictEqual(guardado, false, "un solo reintento agotado sigue siendo un fallo, no un exito silencioso");
  } finally {
    console.error = original;
  }
});

test("upsert devuelve false (no undefined) ante un error real de escritura, y lo deja en el log", async (t) => {
  const original = console.error;
  const llamadasError = [];
  console.error = (...args) => llamadasError.push(args);

  t.mock.method(supabase, "from", () => ({
    select() { return this; },
    eq() { return this; },
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    insert: () => Promise.resolve({ error: { code: "23514", message: "check constraint violation" } }),
  }));

  try {
    const guardado = await colegas.upsert("org-1", { lid: "777888999", telefono: "573007778899" });
    assert.strictEqual(guardado, false, "un fallo real no puede ser indistinguible de un exito (antes devolvia undefined en ambos casos)");
    assert.ok(llamadasError.length > 0, "el fallo tiene que dejar rastro en el log, no solo un warn que nadie mira");
  } finally {
    console.error = original;
  }
});

// ── esSoloLlamada contra la base (Juan, 2026-09-10) ──────────────────────

function cadenaQueResuelve(resultado, filtros) {
  const c = {
    select: () => c,
    eq: (col, val) => { filtros.push(["eq", col, val]); return c; },
    or: (f) => { filtros.push(["or", f]); return c; },
    in: (col, vals) => { filtros.push(["in", col, vals]); return c; },
    limit: () => Promise.resolve(resultado),
  };
  return c;
}

test("esSoloLlamada cruza directorio_lids y consulta colegas_grupos por lid O telefono", async (t) => {
  const filtrosDir = [];
  const filtrosCol = [];
  t.mock.method(supabase, "from", (tabla) => {
    if (tabla === "directorio_lids") {
      return cadenaQueResuelve({ data: [{ lid: "266150634110990", telefono: "573146399667" }], error: null }, filtrosDir);
    }
    assert.strictEqual(tabla, "colegas_grupos");
    return cadenaQueResuelve({ data: [{ id: "c-angela" }], error: null }, filtrosCol);
  });

  const r = await colegas.esSoloLlamada(ORG, { lid: "266150634110990" });
  assert.strictEqual(r, true);
  assert.ok(filtrosCol.some((f) => f[0] === "eq" && f[1] === "org_id" && f[2] === ORG), "filtra por org");
  assert.ok(filtrosCol.some((f) => f[0] === "eq" && f[1] === "solo_llamada" && f[2] === true));
  const or = filtrosCol.find((f) => f[0] === "or")[1];
  assert.match(or, /lid\.in\.\([^)]*266150634110990/);
  assert.match(or, /telefono\.in\.\([^)]*3146399667/, "el telefono que dio el directorio entra al filtro");
});

test("esSoloLlamada devuelve null (no false) si la base falla: falla cerrado", async (t) => {
  const original = console.error;
  console.error = () => {};
  t.mock.method(supabase, "from", () => cadenaQueResuelve({ data: null, error: { message: "boom" } }, []));
  try {
    assert.strictEqual(await colegas.esSoloLlamada(ORG, { lid: "266150634110990" }), null);
  } finally {
    console.error = original;
  }
});

// ── marcarSoloLlamada contra la base (Juan, 2026-09-10) ──────────────────
//
// Este es el camino que de verdad escribe en produccion: la revision de esta
// tarea encontro que solo estaba probada la rama en memoria
// (test/colegas-solo-llamada.test.js). Cubre el select por telefono, el
// fallback a directorio_lids cuando la fila no tiene telefono, el update que
// de verdad marca la fila, y el no_encontrado / error que NUNCA deben
// terminar en un update disparado a ciegas.

// update(patch).in(col, vals) — cadena separada de cadenaQueResuelve porque
// el update no lee filtros de eq/in previos, solo el patch y el .in() final.
function cadenaUpdateQueResuelve(resultado, llamadas) {
  return {
    update: (patch) => {
      llamadas.push({ patch });
      return {
        in: (col, vals) => {
          llamadas.push({ metodo: "in", col, vals });
          return Promise.resolve(resultado);
        },
      };
    },
  };
}

test("marcarSoloLlamada: la encuentra por telefono, actualiza esa fila y no toca directorio_lids", async (t) => {
  const tablas = [];
  const filtrosSelect = [];
  const llamadasUpdate = [];

  t.mock.method(supabase, "from", (tabla) => {
    tablas.push(tabla);
    if (tablas.filter((x) => x === "colegas_grupos").length === 1) {
      // Primera vez que se toca colegas_grupos: el select por telefono.
      return cadenaQueResuelve(
        { data: [{ id: "c-angela", lid: "266150634110990", telefono: "573146399667", nombre: "Angela" }], error: null },
        filtrosSelect
      );
    }
    return cadenaUpdateQueResuelve({ error: null }, llamadasUpdate);
  });

  const r = await colegas.marcarSoloLlamada(ORG, { telefono: "573146399667" });

  assert.ok(!tablas.includes("directorio_lids"), "si la encontro por telefono no hace falta cruzar el directorio");

  assert.ok(filtrosSelect.some((f) => f[0] === "eq" && f[1] === "org_id" && f[2] === ORG));
  const inTelefono = filtrosSelect.find((f) => f[0] === "in" && f[1] === "telefono");
  assert.ok(inTelefono, "debe filtrar colegas_grupos por telefono, no traer la tabla completa");
  assert.ok(
    inTelefono[2].includes("573146399667") && inTelefono[2].includes("3146399667"),
    `las variantes deberian incluir el numero con y sin indicativo, vinieron: ${inTelefono[2]}`
  );

  assert.strictEqual(llamadasUpdate.length, 2, "un update(patch) y un .in(id,...)");
  const [{ patch }, { metodo, col, vals }] = llamadasUpdate;
  assert.strictEqual(patch.solo_llamada, true);
  assert.strictEqual(typeof patch.solo_llamada_at, "string");
  assert.ok(!Number.isNaN(Date.parse(patch.solo_llamada_at)), "solo_llamada_at debe ser una fecha ISO valida");
  assert.strictEqual(metodo, "in");
  assert.strictEqual(col, "id");
  assert.deepStrictEqual(vals, ["c-angela"], "debe actualizar exactamente la fila que encontro, no todas");

  assert.deepStrictEqual(r, { ok: true, colega: { nombre: "Angela", telefono: "573146399667", lid: "266150634110990" } });
});

test("marcarSoloLlamada: sin fila por telefono, cruza directorio_lids y marca la que aparece por lid", async (t) => {
  const tablas = [];
  const filtrosDir = [];
  const filtrosColPorLid = [];
  const llamadasUpdate = [];
  let vecesColegas = 0;

  t.mock.method(supabase, "from", (tabla) => {
    tablas.push(tabla);
    if (tabla === "directorio_lids") {
      return cadenaQueResuelve({ data: [{ lid: "266150634110990" }], error: null }, filtrosDir);
    }
    assert.strictEqual(tabla, "colegas_grupos");
    vecesColegas += 1;
    if (vecesColegas === 1) {
      // Nadie tiene ese telefono guardado directamente.
      return cadenaQueResuelve({ data: [], error: null }, []);
    }
    if (vecesColegas === 2) {
      // Segunda pasada: por el lid que trajo directorio_lids.
      return cadenaQueResuelve(
        { data: [{ id: "c-angela", lid: "266150634110990", telefono: null, nombre: "Angela" }], error: null },
        filtrosColPorLid
      );
    }
    return cadenaUpdateQueResuelve({ error: null }, llamadasUpdate);
  });

  const r = await colegas.marcarSoloLlamada(ORG, { telefono: "3146399667" });

  assert.ok(tablas.includes("directorio_lids"), "sin fila por telefono debe caer al directorio");
  assert.ok(filtrosDir.some((f) => f[0] === "eq" && f[1] === "org_id" && f[2] === ORG), "directorio_lids tambien se filtra por org");
  const dirInTelefono = filtrosDir.find((f) => f[0] === "in" && f[1] === "telefono");
  assert.ok(dirInTelefono && dirInTelefono[2].includes("3146399667"));

  const colInLid = filtrosColPorLid.find((f) => f[0] === "in" && f[1] === "lid");
  assert.ok(colInLid, "la segunda consulta a colegas_grupos debe filtrar por el lid que trajo el directorio");
  assert.deepStrictEqual(colInLid[2], ["266150634110990"]);

  assert.strictEqual(llamadasUpdate.length, 2);
  assert.strictEqual(llamadasUpdate[0].patch.solo_llamada, true);
  assert.deepStrictEqual(llamadasUpdate[1].vals, ["c-angela"]);

  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.colega.lid, "266150634110990");
});

test("marcarSoloLlamada: no aparece ni por telefono ni por directorio_lids -- no_encontrado, y jamas llama a update", async (t) => {
  let updateFueLlamado = false;

  t.mock.method(supabase, "from", (tabla) => {
    if (tabla === "directorio_lids") {
      return cadenaQueResuelve({ data: [], error: null }, []);
    }
    assert.strictEqual(tabla, "colegas_grupos");
    return {
      select: () => ({ eq: () => ({ in: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }),
      update: () => {
        updateFueLlamado = true;
        return { in: () => Promise.resolve({ error: null }) };
      },
    };
  });

  const r = await colegas.marcarSoloLlamada(ORG, { telefono: "573146399667" });

  assert.deepStrictEqual(r, { ok: false, motivo: "no_encontrado" });
  assert.strictEqual(updateFueLlamado, false, "sin fila que marcar, nunca debe llegar a escribir en la base");
});

test("marcarSoloLlamada: un error de consulta contra la base es 'error', no un falso no_encontrado", async (t) => {
  const original = console.error;
  console.error = () => {};
  t.mock.method(supabase, "from", () => cadenaQueResuelve({ data: null, error: { message: "boom" } }, []));
  try {
    const r = await colegas.marcarSoloLlamada(ORG, { telefono: "573146399667" });
    assert.deepStrictEqual(r, { ok: false, motivo: "error" });
  } finally {
    console.error = original;
  }
});
