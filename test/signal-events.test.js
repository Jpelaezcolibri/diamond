// Learning Domain — el Event Store.
//
// Estos tests protegen decisiones permanentes, no comportamiento incidental.
// Si alguno falla, lo que se rompio es un principio del DEOS:
//
//   P15  la historia se modela como eventos inmutables
//   P16  el orden de los eventos es parte del conocimiento
//   dependencia: Radar -> Learning Domain, nunca al reves

const { test } = require("node:test");
const assert = require("node:assert");
const { readFileSync } = require("node:fs");
const path = require("node:path");

// src/data/supabase.js NO crea el cliente real bajo test (guard 2026-08-24,
// ver ese archivo). Este test SI necesita un cliente truthy para poder
// mockear su metodo from() por tabla, asi que se inyecta un doble en el
// cache del modulo antes de cargar signal-events.js — mismo patron que
// test/colegas-data.test.js y test/directorio.test.js usan para forzar null.
const supabasePath = require.resolve("../src/data/supabase");
delete require.cache[supabasePath];
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: { from: () => { throw new Error("from() sin mockear en este test"); } },
};

const signalEvents = require("../src/data/signal-events");
const supabase = require("../src/data/supabase");

const ORG = "org-1";

// ── El recorrido ──────────────────────────────────────────────────────────

test("los tipos cubren el recorrido completo, del silencio al cierre", () => {
  assert.deepStrictEqual(signalEvents.TIPOS, [
    "SIN_RESPUESTA", "CONVERSACION", "VISITA",
    "NEGOCIACION", "CIERRE", "PERDIDO", "DESCARTADO",
  ]);
});

test("PERDIDO y DESCARTADO existen: Radar aprende del fracaso, no solo del cierre", () => {
  assert.ok(signalEvents.TIPOS.includes("PERDIDO"));
  assert.ok(signalEvents.TIPOS.includes("DESCARTADO"));
});

// ── Validacion (no toca la base: revienta antes) ──────────────────────────

test("un tipo inventado no entra al Event Store", async () => {
  await assert.rejects(
    () => signalEvents.registrar(ORG, { signalId: "s1", tipo: "TAL_VEZ" }),
    /Tipo de evento invalido/
  );
});

test("un evento sin oportunidad no ensena nada y se rechaza", async () => {
  await assert.rejects(
    () => signalEvents.registrar(ORG, { signalId: null, tipo: "CIERRE" }),
    /Falta signalId/
  );
});

// ── P15: append-only ──────────────────────────────────────────────────────

test("P15 — el modulo no expone ninguna forma de mutar la historia", () => {
  const MUTADORES = /actualiz|update|borr|delete|elimin|set|patch|upsert/i;
  const expuestos = Object.keys(signalEvents).filter((k) => MUTADORES.test(k));
  assert.deepStrictEqual(
    expuestos, [],
    `El Event Store es append-only. Si algo cambia se registra un evento nuevo, ` +
    `no se reescribe el anterior. Sobra: ${expuestos.join(", ")}`
  );
});

test("P15 — la migracion pone la inmutabilidad en la base, no solo en el codigo", () => {
  // Un modulo sin mutadores no alcanza: cualquiera puede correr un UPDATE a
  // mano. La garantia real es el trigger.
  const sql = readFileSync(
    path.join(__dirname, "../db/migrations/2026-08-02_learning_domain.sql"), "utf8"
  );
  assert.match(sql, /before update or delete on signal_events/i);
  assert.match(sql, /raise exception/i);
});

// ── Dependencia: Radar -> Learning Domain, nunca al reves ────────────────

test("el Learning Domain no depende de Radar — se puede apagar entero", () => {
  const src = readFileSync(path.join(__dirname, "../src/data/signal-events.js"), "utf8");
  const requires = [...src.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);

  // Solo infraestructura de datos. Si esto crece hacia ../groups/, ../agent/ o
  // ../scheduler/, la flecha se invirtio y el Learning Engine dejo de ser
  // apagable sin romper el producto.
  assert.deepStrictEqual(
    requires.sort(), ["./memory", "./supabase"],
    `El Event Store solo puede depender de la capa de datos. Encontrado: ${requires.join(", ")}`
  );
});

// ── P16: el orden es parte del conocimiento ──────────────────────────────

// Se mockea `from` del doble inyectado arriba (no hay cliente real bajo test).
function mockDe(filas) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => Promise.resolve({ data: filas, error: null }),
  };
  return () => chain;
}

test("P16 — la historia vuelve en orden cronologico", async (t) => {
  const enOrden = [
    { id: "e1", signal_id: "s1", tipo: "CONVERSACION", created_at: "2026-08-01T10:00:00Z" },
    { id: "e2", signal_id: "s1", tipo: "VISITA", created_at: "2026-08-03T10:00:00Z" },
    { id: "e3", signal_id: "s1", tipo: "PERDIDO", created_at: "2026-08-05T10:00:00Z" },
  ];
  t.mock.method(supabase, "from", mockDe(enOrden));

  const h = await signalEvents.historia(ORG, "s1");
  assert.deepStrictEqual(h.map((e) => e.tipo), ["CONVERSACION", "VISITA", "PERDIDO"]);
});

test("ultimoPorSenal devuelve el ultimo evento de cada oportunidad", async (t) => {
  t.mock.method(supabase, "from", mockDe([
    { id: "e1", signal_id: "s1", tipo: "CONVERSACION", created_at: "2026-08-01T10:00:00Z" },
    { id: "e2", signal_id: "s2", tipo: "SIN_RESPUESTA", created_at: "2026-08-01T11:00:00Z" },
    { id: "e3", signal_id: "s1", tipo: "CIERRE", created_at: "2026-08-04T10:00:00Z" },
  ]));

  const ultimo = await signalEvents.ultimoPorSenal(ORG, ["s1", "s2"]);
  assert.strictEqual(ultimo.get("s1").tipo, "CIERRE");
  assert.strictEqual(ultimo.get("s2").tipo, "SIN_RESPUESTA");
});

test("sin señales no se consulta la base", async (t) => {
  const espia = t.mock.method(supabase, "from", mockDe([]));
  const ultimo = await signalEvents.ultimoPorSenal(ORG, []);
  assert.strictEqual(ultimo.size, 0);
  assert.strictEqual(espia.mock.callCount(), 0);
});

// ── El producto no puede caerse porque falte el aprendizaje ──────────────

test("si la tabla no existe todavia, registrar avisa y devuelve null — no tumba a nadie", async (t) => {
  t.mock.method(supabase, "from", () => ({
    insert: () => ({
      select: () => ({
        single: () => Promise.resolve({ data: null, error: { code: "42P01" } }),
      }),
    }),
  }));
  t.mock.method(console, "warn", () => {});

  const r = await signalEvents.registrar(ORG, { signalId: "s1", tipo: "CIERRE" });
  assert.strictEqual(r, null, "una migracion sin correr no puede romper el flujo del asesor");
});
