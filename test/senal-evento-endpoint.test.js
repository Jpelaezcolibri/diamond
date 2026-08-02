// El endpoint que cierra la cadena de aprendizaje.
//
// Es el ultimo eslabon de P14 y el unico que no se puede reconstruir despues:
// una decision real de un asesor, en el momento en que ocurrio, es irrepetible.
// Si este endpoint acepta basura o pierde eventos en silencio, el activo
// estrategico #4 se llena de datos que no enseñan nada.

const { test } = require("node:test");
const assert = require("node:assert");

const signalEvents = require("../src/data/signal-events");
const organizations = require("../src/data/organizations");

// El endpoint es una ruta de Express; se ejercita su handler a traves del
// router, sin levantar el servidor.
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

test("registra un evento del recorrido", async (t) => {
  t.mock.method(organizations, "getDefault", async () => ORG);
  const registrados = [];
  t.mock.method(signalEvents, "registrar", async (orgId, e) => {
    registrados.push({ orgId, ...e });
    return { id: "ev-1", ...e };
  });

  const res = respuestaFalsa();
  await rutaDe("/api/grupos/senal/evento")(
    { body: { signalId: "sig-1", tipo: "VISITA", motivo: null, advisorId: "adv-1" } },
    res
  );

  assert.strictEqual(res.codigo, 200);
  assert.deepStrictEqual(registrados, [
    { orgId: "org-1", signalId: "sig-1", tipo: "VISITA", motivo: null, advisorId: "adv-1" },
  ]);
});

test("un tipo inventado no entra", async (t) => {
  const espia = t.mock.method(signalEvents, "registrar", async () => ({ id: "x" }));
  const res = respuestaFalsa();
  await rutaDe("/api/grupos/senal/evento")({ body: { signalId: "sig-1", tipo: "MAS_O_MENOS" } }, res);

  assert.strictEqual(res.codigo, 400);
  assert.strictEqual(espia.mock.callCount(), 0, "no puede llegar a la base");
});

test("sin signalId no hay evento — no se registra al aire", async (t) => {
  const espia = t.mock.method(signalEvents, "registrar", async () => ({ id: "x" }));
  const res = respuestaFalsa();
  await rutaDe("/api/grupos/senal/evento")({ body: { tipo: "CIERRE" } }, res);

  assert.strictEqual(res.codigo, 400);
  assert.strictEqual(espia.mock.callCount(), 0);
});

test("el motivo viaja: un fracaso sin motivo enseña la mitad", async (t) => {
  t.mock.method(organizations, "getDefault", async () => ORG);
  let recibido = null;
  t.mock.method(signalEvents, "registrar", async (orgId, e) => { recibido = e; return { id: "ev" } });

  await rutaDe("/api/grupos/senal/evento")(
    { body: { signalId: "s1", tipo: "PERDIDO", motivo: "ya habia conseguido con otro" } },
    respuestaFalsa()
  );
  assert.strictEqual(recibido.motivo, "ya habia conseguido con otro");
});

test("si falta la migracion avisa en vez de fingir que guardo", async (t) => {
  t.mock.method(organizations, "getDefault", async () => ORG);
  t.mock.method(signalEvents, "registrar", async () => null);

  const res = respuestaFalsa();
  await rutaDe("/api/grupos/senal/evento")({ body: { signalId: "s1", tipo: "CIERRE" } }, res);

  assert.strictEqual(res.codigo, 503);
  assert.match(res.cuerpo.error, /learning_domain/);
});

test("los siete pasos del recorrido son aceptados", async (t) => {
  t.mock.method(organizations, "getDefault", async () => ORG);
  t.mock.method(signalEvents, "registrar", async (o, e) => ({ id: "ev", ...e }));

  for (const tipo of signalEvents.TIPOS) {
    const res = respuestaFalsa();
    await rutaDe("/api/grupos/senal/evento")({ body: { signalId: "s1", tipo } }, res);
    assert.strictEqual(res.codigo, 200, `${tipo} deberia aceptarse`);
  }
});
