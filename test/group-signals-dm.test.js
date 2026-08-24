// Limites del DM directo al colega (src/groups/politica.js#decidirDm): cuantos
// DMs recibio HOY ese colega puntual, y cuantos mando la linea en total.
//
// Las dos consultas comparten un criterio deliberado: cuentan filas con
// respuesta_modo='auto', el MISMO valor que ya usa el camino que publica
// DENTRO del grupo (no se agrega un valor nuevo a la columna — evita otra
// migracion sobre el check de db/migrations/2026-08-16_radar_vivo.sql). Ver
// la nota completa junto a las funciones en src/data/group-signals.js.

const { test } = require("node:test");
const assert = require("node:assert");

// src/data/supabase.js NO crea el cliente real bajo test (guard 2026-08-24).
// Sin supabase, este modulo cae a su rama de memoria — que es la que se
// prueba primero, sin necesitar ningun doble.
const groupSignals = require("../src/data/group-signals");

test("dmsHoyPorColega sin supabase (modo memoria/test) devuelve 0, no null -- mismo criterio que respuestasDesde", async () => {
  const n = await groupSignals.dmsHoyPorColega("org-1", "573001234567", new Date().toISOString());
  assert.strictEqual(n, 0);
});

test("dmsHoyPorColega sin telefono no tiene nada que contar", async () => {
  const n = await groupSignals.dmsHoyPorColega("org-1", null, new Date().toISOString());
  assert.strictEqual(n, null);
});

test("dmsHoyLinea sin supabase (modo memoria/test) devuelve 0", async () => {
  const n = await groupSignals.dmsHoyLinea("org-1", new Date().toISOString());
  assert.strictEqual(n, 0);
});

// ── Con un doble de supabase: se verifica el filtro exacto de la consulta ──
//
// Mismo patron que test/signal-events.test.js: se inyecta un doble en el cache
// del modulo ANTES de cargar group-signals.js, porque src/data/supabase.js
// exporta null bajo test.

function construirQuery(resultado) {
  const llamadas = [];
  const q = {};
  for (const metodo of ["select", "eq", "gte", "order", "limit"]) {
    q[metodo] = (...args) => { llamadas.push([metodo, ...args]); return q; };
  }
  // El builder real de supabase-js es "thenable": awaitarlo dispara la query.
  q.then = (resolve) => resolve(resultado);
  return { q, llamadas };
}

function instalarConSupabase(resultado) {
  const supabasePath = require.resolve("../src/data/supabase");
  const groupSignalsPath = require.resolve("../src/data/group-signals");
  const llamadasPorTabla = [];
  delete require.cache[supabasePath];
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true,
    exports: {
      from: (tabla) => {
        const { q, llamadas } = construirQuery(resultado);
        llamadasPorTabla.push({ tabla, llamadas });
        return q;
      },
    },
  };
  delete require.cache[groupSignalsPath];
  const mod = require("../src/data/group-signals");
  return { mod, llamadasPorTabla };
}

test("dmsHoyPorColega filtra por org, por el telefono/lid del colega, por respuesta_modo=auto y por la fecha", async () => {
  const { mod, llamadasPorTabla } = instalarConSupabase({ data: [{ id: "s1" }, { id: "s2" }], error: null });

  const n = await mod.dmsHoyPorColega("org-9", "141746805670125", "2026-08-24T00:00:00.000Z");
  assert.strictEqual(n, 2);

  assert.strictEqual(llamadasPorTabla.length, 1);
  assert.strictEqual(llamadasPorTabla[0].tabla, "group_signals");
  const filtros = llamadasPorTabla[0].llamadas.filter(([m]) => m === "eq" || m === "gte");
  assert.deepStrictEqual(filtros, [
    ["eq", "org_id", "org-9"],
    ["eq", "autor_telefono", "141746805670125"],
    ["eq", "respuesta_modo", "auto"],
    ["gte", "respondida_at", "2026-08-24T00:00:00.000Z"],
  ]);
});

test("dmsHoyLinea filtra por org y respuesta_modo=auto, sin acotar por colega", async () => {
  const { mod, llamadasPorTabla } = instalarConSupabase({ data: [{ id: "s1" }], error: null });

  const n = await mod.dmsHoyLinea("org-9", "2026-08-24T00:00:00.000Z");
  assert.strictEqual(n, 1);

  const filtros = llamadasPorTabla[0].llamadas.filter(([m]) => m === "eq" || m === "gte");
  assert.deepStrictEqual(filtros, [
    ["eq", "org_id", "org-9"],
    ["eq", "respuesta_modo", "auto"],
    ["gte", "respondida_at", "2026-08-24T00:00:00.000Z"],
  ]);
});

test("dmsHoyPorColega: si la migracion no corrio (columna faltante), devuelve null -- ante la duda, no se envia", async () => {
  const { mod } = instalarConSupabase({ data: null, error: { code: "PGRST204", message: "columna faltante" } });
  const n = await mod.dmsHoyPorColega("org-9", "573001234567", "2026-08-24T00:00:00.000Z");
  assert.strictEqual(n, null);
});

test("dmsHoyLinea: un fallo de la base tambien devuelve null, no un cero optimista", async () => {
  const { mod } = instalarConSupabase({ data: null, error: { code: "500", message: "boom" } });
  const n = await mod.dmsHoyLinea("org-9", "2026-08-24T00:00:00.000Z");
  assert.strictEqual(n, null);
});
