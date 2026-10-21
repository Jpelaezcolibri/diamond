// POST /api/respuestas/atendida: el boton "Marcar atendida" de la pestaña
// Publicaciones del CRM. Mismo estilo que test/vigencia-endpoint.test.js.
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
const datos = require("../src/data/respuestas-publicacion");
const router = require("../src/api/crm");

const ORG = { id: "org-1", name: "Diamond" };

function rutaDe(path) {
  const capa = router.stack.find((c) => c.route?.path === path && c.route.methods.post);
  assert.ok(capa, `No existe POST ${path}`);
  return capa.route.stack[capa.route.stack.length - 1].handle;
}
function respuestaFalsa() {
  const r = { codigo: 200, cuerpo: null };
  r.status = (c) => { r.codigo = c; return r; };
  r.json = (b) => { r.cuerpo = b; return r; };
  return r;
}
const llamar = async (body) => {
  const res = respuestaFalsa();
  await rutaDe("/api/respuestas/atendida")({ body }, res);
  return res;
};

test("faltan datos: 400", async () => {
  assert.equal((await llamar({ id: "r1" })).codigo, 400);
  assert.equal((await llamar({ authUserId: "u1" })).codigo, 400);
});

test("usuario que no es asesor activo ni admin: 403 y no toca la fila", async (t) => {
  t.mock.method(organizations, "getDefault", async () => ORG);
  t.mock.method(advisors, "findByAuthUserId", async () => ({ id: "a1", activo: false }));
  const marcar = t.mock.method(datos, "marcarAtendidaPorId", async () => ({ ok: true, ya: false }));
  const res = await llamar({ id: "r1", authUserId: "u1" });
  assert.equal(res.codigo, 403);
  assert.deepEqual(res.cuerpo, { ok: false, error: "no_es_del_equipo" });
  assert.equal(marcar.mock.callCount(), 0);
});

test("asesor activo: marca la fila de su org como 'manual'", async (t) => {
  t.mock.method(organizations, "getDefault", async () => ORG);
  t.mock.method(advisors, "findByAuthUserId", async () => ({ id: "a1", activo: true }));
  const marcar = t.mock.method(datos, "marcarAtendidaPorId", async () => ({ ok: true, ya: false }));
  const res = await llamar({ id: "r1", authUserId: "u1" });
  assert.equal(res.codigo, 200);
  assert.deepEqual(res.cuerpo, { ok: true, ya: false });
  assert.deepEqual(marcar.mock.calls[0].arguments, ["org-1", "r1", "manual"]);
});

test("admin del CRM sin fila de asesor: puede marcar", async (t) => {
  t.mock.method(organizations, "getDefault", async () => ORG);
  const buscar = t.mock.method(advisors, "findByAuthUserId", async () => null);
  t.mock.method(datos, "marcarAtendidaPorId", async () => ({ ok: true, ya: true }));
  const res = await llamar({ id: "r1", authUserId: "u1", esAdmin: true });
  assert.equal(res.codigo, 200);
  assert.equal(res.cuerpo.ya, true);
  assert.equal(buscar.mock.callCount(), 0);
});

test("la respuesta no existe en la org: 404", async (t) => {
  t.mock.method(organizations, "getDefault", async () => ORG);
  t.mock.method(advisors, "findByAuthUserId", async () => ({ id: "a1", activo: true }));
  t.mock.method(datos, "marcarAtendidaPorId", async () => ({ ok: false }));
  assert.equal((await llamar({ id: "otra", authUserId: "u1" })).codigo, 404);
});

test("error de base: 500", async (t) => {
  t.mock.method(console, "error", () => {});
  t.mock.method(organizations, "getDefault", async () => ORG);
  t.mock.method(advisors, "findByAuthUserId", async () => ({ id: "a1", activo: true }));
  t.mock.method(datos, "marcarAtendidaPorId", async () => { throw new Error("db"); });
  const res = await llamar({ id: "r1", authUserId: "u1" });
  assert.equal(res.codigo, 500);
  assert.equal(res.cuerpo.ok, false);
});

// La funcion de datos: filtra por org e id, y no pisa una ya atendida.
function supaFalso(respuestas) {
  const llamadas = [];
  const q = (tabla) => {
    const c = { tabla, ops: [] };
    llamadas.push(c);
    const api = {
      update: (v) => { c.ops.push(["update", v]); return api; },
      select: (v) => { c.ops.push(["select", v]); return api; },
      eq: (k, v) => { c.ops.push(["eq", k, v]); return api; },
      is: (k, v) => { c.ops.push(["is", k, v]); return api; },
      maybeSingle: async () => respuestas.shift(),
      then: (ok, ko) => Promise.resolve(respuestas.shift()).then(ok, ko),
    };
    return api;
  };
  return { from: q, llamadas };
}

test("marcarAtendidaPorId: actualiza por org e id, solo si no estaba atendida", async (t) => {
  const s = supaFalso([{ data: [{ id: "r1" }], error: null }]);
  t.mock.method(datos, "_supabase", () => s);
  assert.deepEqual(await datos.marcarAtendidaPorId("org-1", "r1"), { ok: true, ya: false });
  const ops = s.llamadas[0].ops;
  assert.equal(ops[0][0], "update");
  assert.equal(ops[0][1].atendida_por, "manual");
  assert.ok(ops.some((o) => o[0] === "eq" && o[1] === "org_id" && o[2] === "org-1"));
  assert.ok(ops.some((o) => o[0] === "eq" && o[1] === "id" && o[2] === "r1"));
  assert.ok(ops.some((o) => o[0] === "is" && o[1] === "atendida_at" && o[2] === null));
});

test("marcarAtendidaPorId: ya atendida -> ya:true; inexistente -> ok:false", async (t) => {
  let s = supaFalso([{ data: [], error: null }, { data: { id: "r1" }, error: null }]);
  t.mock.method(datos, "_supabase", () => s);
  assert.deepEqual(await datos.marcarAtendidaPorId("org-1", "r1"), { ok: true, ya: true });
  s = supaFalso([{ data: [], error: null }, { data: null, error: null }]);
  assert.deepEqual(await datos.marcarAtendidaPorId("org-1", "zz"), { ok: false });
});
