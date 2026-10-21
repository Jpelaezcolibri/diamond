// /api/demanda: mapa de demanda del CRM. Mismo estilo que
// test/vigencia-endpoint.test.js (handler a traves del router).
const { test } = require("node:test");
const assert = require("node:assert");

const supabasePath = require.resolve("../src/data/supabase");
delete require.cache[supabasePath];
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: { from: () => { throw new Error("from() sin mockear en este test"); } },
};

const organizations = require("../src/data/organizations");
const advisors = require("../src/data/advisors");
const demanda = require("../src/data/demanda");
const router = require("../src/api/crm");

const ORG = { id: "org-1", name: "Diamond Inmobiliaria" };

function rutaDe(path, metodo = "post") {
  const capa = router.stack.find((c) => c.route?.path === path && c.route.methods[metodo]);
  assert.ok(capa, `No existe ${metodo.toUpperCase()} ${path}`);
  return capa.route.stack[capa.route.stack.length - 1].handle;
}
function respuestaFalsa() {
  const r = { codigo: 200, cuerpo: null };
  r.status = (c) => { r.codigo = c; return r; };
  r.json = (b) => { r.cuerpo = b; return r; };
  return r;
}

test("sin authUserId: 400", async () => {
  const res = respuestaFalsa();
  await rutaDe("/api/demanda")({ body: { dias: 30 } }, res);
  assert.equal(res.codigo, 400);
});

test("usuario que no es del equipo: 403 y no calcula", async (t) => {
  t.mock.method(organizations, "getDefault", async () => ORG);
  t.mock.method(advisors, "findByAuthUserId", async () => null);
  const mapa = t.mock.method(demanda, "mapa", async () => ({}));
  const res = respuestaFalsa();
  await rutaDe("/api/demanda")({ body: { authUserId: "u1" } }, res);
  assert.equal(res.codigo, 403);
  assert.deepEqual(res.cuerpo, { ok: false, error: "no_es_del_equipo" });
  assert.equal(mapa.mock.callCount(), 0);
});

test("asesor activo: calcula con la org por defecto y el periodo pedido", async (t) => {
  t.mock.method(organizations, "getDefault", async () => ORG);
  const buscar = t.mock.method(advisors, "findByAuthUserId", async () => ({ id: "a1", activo: true }));
  const mapa = t.mock.method(demanda, "mapa", async () => ({ dias: 90, celdas: [] }));
  const res = respuestaFalsa();
  await rutaDe("/api/demanda")({ body: { authUserId: "u1", dias: 90, operacion: "arriendo" } }, res);
  assert.equal(res.codigo, 200);
  assert.equal(res.cuerpo.ok, true);
  assert.deepEqual(res.cuerpo.org, { name: "Diamond Inmobiliaria" });
  assert.deepEqual(buscar.mock.calls[0].arguments, ["org-1", "u1"]);
  assert.deepEqual(mapa.mock.calls[0].arguments, [ORG, { dias: 90, operacion: "arriendo" }]);
});

test("admin no necesita fila de asesor; valores raros caen a 30 días y venta", async (t) => {
  t.mock.method(organizations, "getDefault", async () => ORG);
  const buscar = t.mock.method(advisors, "findByAuthUserId", async () => null);
  const mapa = t.mock.method(demanda, "mapa", async () => ({}));
  const res = respuestaFalsa();
  await rutaDe("/api/demanda")({ body: { authUserId: "u1", esAdmin: true, dias: 45, operacion: "x" } }, res);
  assert.equal(res.codigo, 200);
  assert.equal(buscar.mock.callCount(), 0);
  assert.deepEqual(mapa.mock.calls[0].arguments[1], { dias: 30, operacion: "venta" });
});

test("error al calcular: 500", async (t) => {
  t.mock.method(console, "error", () => {});
  t.mock.method(organizations, "getDefault", async () => ORG);
  t.mock.method(demanda, "mapa", async () => { throw new Error("db"); });
  const res = respuestaFalsa();
  await rutaDe("/api/demanda")({ body: { authUserId: "u1", esAdmin: true } }, res);
  assert.equal(res.codigo, 500);
  assert.equal(res.cuerpo.ok, false);
});

test("cache de 10 minutos por org + periodo + operacion", async (t) => {
  demanda.limpiarCache();
  const supabase = require("../src/data/supabase");
  let consultas = 0;
  const q = {
    select() { return q; }, eq() { return q; }, gte() { return q; }, order() { return q; },
    range() { consultas++; return Promise.resolve({ data: [], error: null }); },
    then(ok, mal) { consultas++; return Promise.resolve({ data: [], error: null }).then(ok, mal); },
  };
  t.mock.method(supabase, "from", () => q);
  const ahora = Date.parse("2026-10-21T15:00:00Z");
  const a = await demanda.mapa(ORG, { dias: 30, operacion: "venta", ahora });
  assert.equal(a.cache, false);
  assert.equal(consultas, 2);
  const b = await demanda.mapa(ORG, { dias: 30, operacion: "venta", ahora: ahora + 5 * 60e3 });
  assert.equal(b.cache, true);
  assert.equal(consultas, 2);
  await demanda.mapa(ORG, { dias: 7, operacion: "venta", ahora });
  assert.equal(consultas, 4);
  await demanda.mapa(ORG, { dias: 30, operacion: "venta", ahora: ahora + 11 * 60e3 });
  assert.equal(consultas, 6);
  demanda.limpiarCache();
});
