// Los endpoints por token de la pagina del aviso (Juan, 2026-09-02, opcion
// D). Tarea 3 del plan docs/superpowers/plans/2026-09-03-radar-link-en-el-aviso.md
//
// Mismo estilo que senal-responder-dm-endpoint.test.js: se ejercita el
// handler de Express a traves del router, sin levantar el servidor.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const groupSignals = require("../src/data/group-signals");
const organizations = require("../src/data/organizations");
const whatsappGroups = require("../src/data/whatsapp-groups");
const vivo = require("../src/groups/vivo");
const router = require("../src/api/crm");

function rutaDe(path) {
  const capa = router.stack.find((c) => c.route?.path === path && c.route.methods.post);
  assert.ok(capa, `No existe POST ${path}`);
  return capa.route.stack[capa.route.stack.length - 1].handle;
}
function res() {
  const r = { codigo: 200, cuerpo: null };
  r.status = (c) => { r.codigo = c; return r; };
  r.json = (b) => { r.cuerpo = b; return r; };
  return r;
}

let token;
beforeEach(async () => {
  memory.groupSignals.length = 0;
  memory.groupSignals.push({
    id: "s1", org_id: "org-1", clase: "demanda", estado: "nuevo", autor_nombre: "Julieth",
    texto_original: "Busco apto", matches: [], revalidacion: { refs_utiles: [], refs_dudosas: [] },
  });
  token = await groupSignals.asegurarToken("org-1", "s1");
});

test("ver: la primera apertura marca visto, la segunda no", async (t) => {
  t.mock.method(organizations, "findById", async () => ({ id: "org-1", name: "Diamond" }));
  t.mock.method(whatsappGroups, "listSessions", async () => [{ nombre: "RADA-NATALIA", estado: "activa" }]);
  const llamadas = [];
  t.mock.method(vivo, "prepararAviso", async (org, signalId, opts) => {
    llamadas.push({ org, signalId, opts });
    return { resultado: "ok", senal: { id: "s1" }, utiles: [], dudosas: [], mensaje: null, telefonoColega: null, motivo: "sin_telefono", porque: "x", aprobada: false };
  });

  const r1 = res();
  await rutaDe("/api/grupos/aviso/ver")({ body: { token } }, r1);
  assert.strictEqual(r1.codigo, 200);
  assert.strictEqual(r1.cuerpo.visto_ahora, true);
  assert.strictEqual(r1.cuerpo.org.name, "Diamond");
  assert.deepStrictEqual(llamadas[0].opts, { sesion: "RADA-NATALIA" }, "le pasa la sesion activa para resolver el telefono");

  const r2 = res();
  await rutaDe("/api/grupos/aviso/ver")({ body: { token } }, r2);
  assert.strictEqual(r2.cuerpo.visto_ahora, false);
  assert.ok(memory.groupSignals[0].visto_at);
});

test("ver: token desconocido o vacio -> 404, sin tocar nada", async () => {
  for (const body of [{ token: "nope" }, {}, { token: "" }]) {
    const r = res();
    await rutaDe("/api/grupos/aviso/ver")({ body }, r);
    assert.strictEqual(r.codigo, 404);
  }
  assert.strictEqual(memory.groupSignals[0].visto_at, undefined);
});

test("gestion: no_sirve se guarda y ademas descarta la señal", async () => {
  const r = res();
  await rutaDe("/api/grupos/aviso/gestion")({ body: { token, gestion: "no_sirve" } }, r);
  assert.strictEqual(r.codigo, 200);
  assert.deepStrictEqual(r.cuerpo, { ok: true, gestion: "no_sirve" });
  assert.strictEqual(memory.groupSignals[0].gestion, "no_sirve");
  assert.strictEqual(memory.groupSignals[0].estado, "descartado");
});

test("gestion: envio se guarda y NO cambia el estado de la señal", async () => {
  const r = res();
  await rutaDe("/api/grupos/aviso/gestion")({ body: { token, gestion: "envio" } }, r);
  assert.strictEqual(r.codigo, 200);
  assert.strictEqual(memory.groupSignals[0].gestion, "envio");
  assert.strictEqual(memory.groupSignals[0].estado, "nuevo");
});

test("gestion: gestion invalida -> 400; token desconocido -> 404", async () => {
  const r1 = res();
  await rutaDe("/api/grupos/aviso/gestion")({ body: { token, gestion: "otra" } }, r1);
  assert.strictEqual(r1.codigo, 400);
  const r2 = res();
  await rutaDe("/api/grupos/aviso/gestion")({ body: { token: "nope", gestion: "envio" } }, r2);
  assert.strictEqual(r2.codigo, 404);
});
