const { test } = require("node:test");
const assert = require("node:assert");
// Supabase falso (el real es null bajo el runner). Se instala ANTES de cargar kit.
const supabasePath = require.resolve("../src/data/supabase");
const fake = { inserts: [], propiedad: null, from(tabla) {
  const self = this;
  const chain = {
    select: () => chain, eq: () => chain, ilike: () => chain,
    maybeSingle: async () => ({ data: self.propiedad, error: null }),
    insert: async (fila) => { self.inserts.push({ tabla, fila }); return { error: null }; },
  };
  return chain;
} };
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fake };
const kit = require("../src/groups/kit");

const base = {
  ref: "10077063", disponible: true, link: "https://info.wasi.co/apartamento-venta-envigado/10077063",
  images: ["https://img/1.jpg", "https://img/2.jpg"], titulo: "Apto", zona: "Envigado", operacion: "Venta",
};

test("aptaParaKit: disponible, con link de Wasi, con foto y no bloqueada", () => {
  const bloq = new Set(["9921388"]);
  assert.strictEqual(kit.aptaParaKit(base, { refsBloqueadas: bloq }), true);
  assert.strictEqual(kit.aptaParaKit({ ...base, disponible: false }, { refsBloqueadas: bloq }), false);
  assert.strictEqual(kit.aptaParaKit({ ...base, link: "" }, { refsBloqueadas: bloq }), false);
  assert.strictEqual(kit.aptaParaKit({ ...base, images: [] }, { refsBloqueadas: bloq }), false);
  assert.strictEqual(kit.aptaParaKit({ ...base, ref: "9921388" }, { refsBloqueadas: bloq }), false);
});

test("etiquetaUltima: nunca, reciente con alias, vieja", () => {
  const ahora = new Date("2026-10-16T12:00:00Z");
  assert.deepStrictEqual(kit.etiquetaUltima(null, {}, ahora), { texto: "Nunca compartida", reciente: false });
  assert.deepStrictEqual(
    kit.etiquetaUltima({ user_id: "u1", created_at: "2026-10-14T12:00:00Z" }, { u1: "Asesor 1" }, ahora),
    { texto: "Compartida hace 2 días por Asesor 1", reciente: true }
  );
  assert.deepStrictEqual(
    kit.etiquetaUltima({ user_id: "u9", created_at: "2026-10-07T12:00:00Z" }, {}, ahora),
    { texto: "Compartida hace 9 días", reciente: false }
  );
  assert.deepStrictEqual(
    kit.etiquetaUltima({ user_id: "u1", created_at: "2026-10-16T09:00:00Z" }, { u1: "Asesor 1" }, ahora),
    { texto: "Compartida hoy por Asesor 1", reciente: true }
  );
});

test("post: null si la propiedad no es publicable", async () => {
  fake.propiedad = { ...base, disponible: false };
  assert.strictEqual(await kit.post({ id: "o1" }, "10077063"), null);
  fake.propiedad = null;
  assert.strictEqual(await kit.post({ id: "o1" }, "10077063"), null);
});

test("registrar: rechaza accion desconocida y acepta las validas", async () => {
  fake.inserts.length = 0;
  assert.deepStrictEqual(await kit.registrar({ id: "o1" }, { ref: "1", accion: "borrar" }), { ok: false });
  assert.deepStrictEqual(await kit.registrar({ id: "o1" }, { ref: "1", userId: "u1", accion: "compartir" }), { ok: true });
  assert.strictEqual(fake.inserts.length, 1);
  assert.strictEqual(fake.inserts[0].fila.accion, "compartir");
});
