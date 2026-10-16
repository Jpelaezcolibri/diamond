const { test } = require("node:test");
const assert = require("node:assert");
const router = require("../src/api/crm");
const kit = require("../src/groups/kit");
const organizations = require("../src/data/organizations");

function handler(path) {
  const capa = router.stack.find((c) => c.route?.path === path && c.route.methods.post);
  assert.ok(capa, `No existe POST ${path}`);
  return capa.route.stack[capa.route.stack.length - 1].handle;
}

async function llamar(path, body) {
  let cuerpo = null;
  let status = 200;
  const res = { json: (b) => { cuerpo = b; return res; }, status: (s) => { status = s; return res; } };
  await handler(path)({ body }, res);
  return { status, cuerpo };
}

const ORG = { id: "org-1", name: "Diamond" };

test("propiedades: pasa operacion y zona al modulo", async (t) => {
  t.mock.method(organizations, "getDefault", async () => ORG);
  const listar = t.mock.method(kit, "listar", async () => ({ fresco: true, items: [], kpis: {} }));
  const r = await llamar("/api/kit/propiedades", { operacion: "Arriendo", zona: "Envigado" });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(listar.mock.calls[0].arguments, [ORG, { operacion: "Arriendo", zona: "Envigado" }]);
});

test("propiedades: operacion invalida cae a Venta", async (t) => {
  t.mock.method(organizations, "getDefault", async () => ORG);
  const listar = t.mock.method(kit, "listar", async () => ({ fresco: true, items: [], kpis: {} }));
  await llamar("/api/kit/propiedades", { operacion: "DROP" });
  assert.strictEqual(listar.mock.calls[0].arguments[1].operacion, "Venta");
});

test("post: 404 si la propiedad no se puede publicar", async (t) => {
  t.mock.method(organizations, "getDefault", async () => ORG);
  t.mock.method(kit, "post", async () => null);
  const r = await llamar("/api/kit/post", { ref: "999" });
  assert.strictEqual(r.status, 404);
});

test("post: sin ref es 400", async (t) => {
  const r = await llamar("/api/kit/post", {});
  assert.strictEqual(r.status, 400);
});

test("registrar: devuelve lo del modulo", async (t) => {
  t.mock.method(organizations, "getDefault", async () => ORG);
  const reg = t.mock.method(kit, "registrar", async () => ({ ok: true }));
  const r = await llamar("/api/kit/registrar", { ref: "10077063", userId: "u1", accion: "compartir" });
  assert.deepStrictEqual(r.cuerpo, { ok: true });
  assert.deepStrictEqual(reg.mock.calls[0].arguments[1], { ref: "10077063", userId: "u1", accion: "compartir" });
});
