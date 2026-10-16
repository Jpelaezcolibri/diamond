const { test } = require("node:test");
const assert = require("node:assert");
// Supabase falso (el real es null bajo el runner). Se instala ANTES de cargar kit.
const supabasePath = require.resolve("../src/data/supabase");
const fake = { inserts: [], ors: [], ilikes: [], propiedad: null, tablas: {}, from(tabla) {
  const self = this;
  const chain = {
    select: () => chain, eq: () => chain, ilike: (c, v) => { self.ilikes.push([c, v]); return chain; }, or: (f) => { self.ors.push(f); return chain; }, gte: () => chain, order: () => chain, limit: () => chain,
    maybeSingle: async () => ({ data: self.propiedad, error: null }),
    insert: async (fila) => { self.inserts.push({ tabla, fila }); return { error: null }; },
    then: (ok, ko) => Promise.resolve({ data: self.tablas[tabla] || [], count: 3, error: null }).then(ok, ko),
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

const syncEstado = require("../src/data/sync-estado");
const verificarLink = require("../src/groups/verificar-link");
const ORG = { id: "o1", name: "Diamond" };
const completa = { ...base, images: ["a", "b", "c", "d", "e", "f"], precio: 400000000 };

test("post: ref con comodines LIKE se rechaza sin consultar", async () => {
  fake.propiedad = completa;
  assert.strictEqual(await kit.post(ORG, "%"), null);
  assert.strictEqual(await kit.post(ORG, "10_7"), null);
});

test("post: camino feliz, 4 fotos, link verificado y comision opcional", async (t) => {
  fake.propiedad = completa;
  const ver = t.mock.method(verificarLink, "verificar", async (l) => ({ verificadas: l, rotas: [] }));
  const r = await kit.post(ORG, "10077063", { comision: true });
  assert.strictEqual(r.fotos.length, kit.FOTOS_MAX);
  assert.strictEqual(r.linkOk, true);
  assert.ok(r.texto.includes(completa.link), "el texto lleva el link de Wasi");
  assert.match(r.texto, /comisi/i);
  const sin = await kit.post(ORG, "10077063", { comision: false });
  assert.doesNotMatch(sin.texto, /comisi/i);
  ver.mock.restore();
  t.mock.method(verificarLink, "verificar", async () => ({ verificadas: [], rotas: [{}] }));
  assert.strictEqual((await kit.post(ORG, "10077063")).linkOk, false);
});

test("listar: inventario viejo no lista nada", async (t) => {
  t.mock.method(syncEstado, "estadoDelInventario", async () => ({ fresco: false, horas: 40 }));
  const r = await kit.listar(ORG, { operacion: "Venta" });
  assert.strictEqual(r.fresco, false);
  assert.deepStrictEqual(r.items, []);
});

test("listar: filtra sin fotos y arma la etiqueta con el alias", async (t) => {
  t.mock.method(syncEstado, "estadoDelInventario", async () => ({ fresco: true, horas: 2 }));
  const hace2 = new Date(Date.now() - 2 * 86400000 - 3600000).toISOString();
  fake.tablas = {
    properties: [completa, { ...completa, ref: "2", images: [] }],
    kit_publicaciones: [{ property_ref: "10077063", user_id: "u1", created_at: hace2 }],
    advisors: [{ auth_user_id: "u1", alias_publico: "Asesor 1" }],
  };
  const r = await kit.listar(ORG, { operacion: "Venta" });
  assert.strictEqual(r.fresco, true);
  assert.strictEqual(r.items.length, 1);
  assert.strictEqual(r.items[0].etiqueta.texto, "Compartida hace 2 días por Asesor 1");
  assert.strictEqual(r.items[0].foto, "a");
  assert.strictEqual(r.kpis.listas, 1);
  fake.tablas = {};
});

test("filtroZonaOr: 'Itagüí' arma un patron que tambien trae 'Itagüi' (sin ilike con tilde)", () => {
  const { filtroZonaOr } = require("../src/data/properties");
  const f = filtroZonaOr("Itagüí");
  assert.ok(f.includes("zona.imatch."), f);
  const patron = f.split(",")[0].replace("zona.imatch.", "");
  assert.ok(new RegExp(patron, "i").test("Itagüi"), "el patron " + patron + " debe traer Itagüi");
  assert.ok(new RegExp(patron, "i").test("Itagui"));
  // zona de varias palabras: usa el token distintivo, no "El"
  const p = filtroZonaOr("El Poblado");
  assert.ok(new RegExp(p.split(",")[0].replace("zona.imatch.", ""), "i").test("Poblado"));
  assert.strictEqual(filtroZonaOr(""), null);
});

test("listar con zona: usa el filtro imatch y no ilike sobre zona", async (t) => {
  t.mock.method(syncEstado, "estadoDelInventario", async () => ({ fresco: true, horas: 2 }));
  fake.tablas = {}; fake.ors.length = 0; fake.ilikes.length = 0;
  await kit.listar(ORG, { operacion: "Venta", zona: "Itagüí" });
  assert.strictEqual(fake.ors.length, 1);
  assert.match(fake.ors[0], /zona.imatch./);
  assert.ok(!fake.ilikes.some(([c]) => c === "zona"), "no debe usar ilike sobre zona");
});

test("registrar: una ref con comodines LIKE o vacia se rechaza sin tocar la base", async () => {
  fake.inserts.length = 0;
  for (const ref of ["%", "10_7", "a b", "", null]) {
    assert.deepStrictEqual(await kit.registrar({ id: "o1" }, { ref, accion: "copiar" }), { ok: false });
  }
  assert.strictEqual(fake.inserts.length, 0);
});
