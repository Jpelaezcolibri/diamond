// El endpoint que dispara el DM manual desde el CRM (Juan, 2026-08-24).
//
// Mismo estilo que senal-evento-endpoint.test.js: se ejercita el handler de
// Express a traves del router, sin levantar el servidor ni tocar WAHA de
// verdad. Lo que importa aca es que la ruta resuelva bien la sesion (falla
// cerrado sin exactamente una activa, igual que aprobarManual) y que le pase
// a vivo.responderPorDmManual justo lo que devolvio, sin inventar nada.

const { test } = require("node:test");
const assert = require("node:assert");

const organizations = require("../src/data/organizations");
const whatsappGroups = require("../src/data/whatsapp-groups");
const vivo = require("../src/groups/vivo");

const router = require("../src/api/crm");

const ORG = { id: "org-1", name: "Diamond" };

function rutaDe(path, metodo = "post") {
  const capa = router.stack.find(
    (c) => c.route?.path === path && c.route.methods[metodo]
  );
  assert.ok(capa, `No existe ${metodo.toUpperCase()} ${path}`);
  return capa.route.stack[capa.route.stack.length - 1].handle;
}

function respuestaFalsa() {
  const r = { codigo: 200, cuerpo: null };
  r.status = (c) => { r.codigo = c; return r; };
  r.json = (b) => { r.cuerpo = b; return r; };
  return r;
}

test("con una sola sesion activa, llama a responderPorDmManual con esa sesion", async (t) => {
  t.mock.method(organizations, "getDefault", async () => ORG);
  t.mock.method(whatsappGroups, "listSessions", async () => [{ nombre: "RADA-NATALIA", estado: "activa" }]);
  const llamadas = [];
  t.mock.method(vivo, "responderPorDmManual", async (org, signalId, opts) => {
    llamadas.push({ org, signalId, opts });
    return { resultado: "dm_enviado", texto: "hola", wamid: "wm-1" };
  });

  const res = respuestaFalsa();
  await rutaDe("/api/grupos/senal/responder-dm")({ body: { signalId: "sig-1" } }, res);

  assert.strictEqual(res.codigo, 200);
  assert.strictEqual(res.cuerpo.ok, true);
  assert.strictEqual(res.cuerpo.resultado, "dm_enviado");
  assert.strictEqual(llamadas.length, 1);
  assert.strictEqual(llamadas[0].signalId, "sig-1");
  assert.strictEqual(llamadas[0].opts.sesion, "RADA-NATALIA");
  assert.strictEqual(llamadas[0].org.id, "org-1");
});

test("sin signalId, no llega a resolver nada", async (t) => {
  const espia = t.mock.method(vivo, "responderPorDmManual", async () => ({ resultado: "dm_enviado" }));
  const res = respuestaFalsa();
  await rutaDe("/api/grupos/senal/responder-dm")({ body: {} }, res);

  assert.strictEqual(res.codigo, 400);
  assert.strictEqual(espia.mock.callCount(), 0);
});

test("sin ninguna sesion activa, falla cerrado en vez de adivinar", async (t) => {
  t.mock.method(organizations, "getDefault", async () => ORG);
  t.mock.method(whatsappGroups, "listSessions", async () => []);
  const espia = t.mock.method(vivo, "responderPorDmManual", async () => ({ resultado: "dm_enviado" }));

  const res = respuestaFalsa();
  await rutaDe("/api/grupos/senal/responder-dm")({ body: { signalId: "sig-1" } }, res);

  assert.strictEqual(res.codigo, 409);
  assert.strictEqual(res.cuerpo.cantidad, 0);
  assert.strictEqual(espia.mock.callCount(), 0);
});

test("con dos sesiones activas, tambien falla cerrado -- ambiguo, no adivina por cual salir", async (t) => {
  t.mock.method(organizations, "getDefault", async () => ORG);
  t.mock.method(whatsappGroups, "listSessions", async () => [
    { nombre: "RADA-NATALIA", estado: "activa" },
    { nombre: "RADA-OTRA", estado: "activa" },
  ]);
  const espia = t.mock.method(vivo, "responderPorDmManual", async () => ({ resultado: "dm_enviado" }));

  const res = respuestaFalsa();
  await rutaDe("/api/grupos/senal/responder-dm")({ body: { signalId: "sig-1" } }, res);

  assert.strictEqual(res.codigo, 409);
  assert.strictEqual(res.cuerpo.cantidad, 2);
  assert.strictEqual(espia.mock.callCount(), 0);
});

test("una sesion inactiva no cuenta como disponible", async (t) => {
  t.mock.method(organizations, "getDefault", async () => ORG);
  t.mock.method(whatsappGroups, "listSessions", async () => [{ nombre: "RADA-NATALIA", estado: "caida" }]);
  const espia = t.mock.method(vivo, "responderPorDmManual", async () => ({ resultado: "dm_enviado" }));

  const res = respuestaFalsa();
  await rutaDe("/api/grupos/senal/responder-dm")({ body: { signalId: "sig-1" } }, res);

  assert.strictEqual(res.codigo, 409);
  assert.strictEqual(espia.mock.callCount(), 0);
});

test("el resultado de vivo.responderPorDmManual se devuelve tal cual, sin filtrar campos", async (t) => {
  t.mock.method(organizations, "getDefault", async () => ORG);
  t.mock.method(whatsappGroups, "listSessions", async () => [{ nombre: "RADA-NATALIA", estado: "activa" }]);
  t.mock.method(vivo, "responderPorDmManual", async () => ({ resultado: "sin_telefono" }));

  const res = respuestaFalsa();
  await rutaDe("/api/grupos/senal/responder-dm")({ body: { signalId: "sig-1" } }, res);

  assert.strictEqual(res.codigo, 200);
  assert.strictEqual(res.cuerpo.ok, true);
  assert.strictEqual(res.cuerpo.resultado, "sin_telefono");
});
