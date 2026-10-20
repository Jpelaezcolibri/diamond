// POST /api/propiedades/vigencia: el boton de "Para atender" del CRM. Mismo
// estilo que test/cancelar-cita-endpoint.test.js (handler a traves del router).
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
const propiedadesAsesor = require("../src/data/propiedades-asesor");
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

test("sin asesor ligado al usuario: 403 no_es_asesor", async (t) => {
  t.mock.method(organizations, "getDefault", async () => ORG);
  t.mock.method(advisors, "findByAuthUserId", async () => null);
  const aplicar = t.mock.method(propiedadesAsesor, "aplicarVigencia", async () => ({}));
  const res = respuestaFalsa();
  await rutaDe("/api/propiedades/vigencia")({ body: { authUserId: "u1", ref: "D1001", sigue: true } }, res);
  assert.equal(res.codigo, 403);
  assert.deepEqual(res.cuerpo, { ok: false, error: "no_es_asesor" });
  assert.equal(aplicar.mock.callCount(), 0);
});

test("asesor inactivo: 403", async (t) => {
  t.mock.method(organizations, "getDefault", async () => ORG);
  t.mock.method(advisors, "findByAuthUserId", async () => ({ id: "a1", activo: false }));
  const res = respuestaFalsa();
  await rutaDe("/api/propiedades/vigencia")({ body: { authUserId: "u1", ref: "D1001", sigue: true } }, res);
  assert.equal(res.codigo, 403);
});

test("faltan datos: 400", async (t) => {
  const res = respuestaFalsa();
  await rutaDe("/api/propiedades/vigencia")({ body: { ref: "D1001" } }, res);
  assert.equal(res.codigo, 400);
});

test("sigue=true renueva; sigue=false da de baja", async (t) => {
  t.mock.method(organizations, "getDefault", async () => ORG);
  t.mock.method(advisors, "findByAuthUserId", async () => ({ id: "a1", activo: true }));
  const aplicar = t.mock.method(propiedadesAsesor, "aplicarVigencia", async (o, a, ref, sigue) => ({ estado: sigue ? "renovada" : "baja", ref }));
  let res = respuestaFalsa();
  await rutaDe("/api/propiedades/vigencia")({ body: { authUserId: "u1", ref: "D1001", sigue: true } }, res);
  assert.equal(res.codigo, 200);
  assert.deepEqual(res.cuerpo, { ok: true, estado: "renovada", ref: "D1001" });
  assert.deepEqual(aplicar.mock.calls[0].arguments, ["org-1", "a1", "D1001", true]);
  res = respuestaFalsa();
  await rutaDe("/api/propiedades/vigencia")({ body: { authUserId: "u1", ref: "D1001", sigue: false } }, res);
  assert.equal(res.cuerpo.estado, "baja");
});

test("error al aplicar: 500", async (t) => {
  t.mock.method(console, "error", () => {});
  t.mock.method(organizations, "getDefault", async () => ORG);
  t.mock.method(advisors, "findByAuthUserId", async () => ({ id: "a1", activo: true }));
  t.mock.method(propiedadesAsesor, "aplicarVigencia", async () => { throw new Error("db"); });
  const res = respuestaFalsa();
  await rutaDe("/api/propiedades/vigencia")({ body: { authUserId: "u1", ref: "D1001", sigue: true } }, res);
  assert.equal(res.codigo, 500);
  assert.equal(res.cuerpo.ok, false);
});
