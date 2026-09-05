// El endpoint que dispara la cancelacion de una cita desde el CRM (Juan,
// 2026-09-04). Sofi nunca cancela sola -- una persona la dispara desde el
// CRM; ver la nota de diseño en src/groups/cancelar-cita.js.
//
// Mismo estilo que test/senal-responder-dm-endpoint.test.js para los primeros
// tres: se ejercita el handler de Express a traves del router, sin levantar
// el servidor, inyectando un doble de cancelar-cita en el cache de modulos
// (t.mock.method sobre el modulo ya requerido -- crm.js lo re-requiere con la
// misma ruta, asi que cae en el mismo objeto de require.cache).
//
// El cuarto test ("exige la x-api-key") es de otra naturaleza: esa regla vive
// en el middleware `router.use("/api", ...)`, invisible si se llama el
// handler a mano como en los tres de arriba. Por eso ese test SI levanta un
// servidor real. Bajo `node --test`, src/data/supabase.js exporta null (guard
// 2026-08-24, ver ese archivo) y el mismo middleware devuelve 501 antes de
// llegar a comprobar la key si no hay cliente -- asi que aca se inyecta un
// doble truthy en require.cache, mismo patron que test/linea-dm.test.js.
const { test } = require("node:test");
const assert = require("node:assert");

const supabasePath = require.resolve("../src/data/supabase");
delete require.cache[supabasePath];
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: { from: () => { throw new Error("from() sin mockear en este test"); } },
};

const config = require("../src/config");
const organizations = require("../src/data/organizations");
const whatsappGroups = require("../src/data/whatsapp-groups");
const cancelarCita = require("../src/groups/cancelar-cita");

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

test("POST /api/citas/cancelar sin leadId responde 400", async (t) => {
  const espia = t.mock.method(cancelarCita, "cancelar", async () => ({
    ok: true, resultado: "cancelada", aviso: "oficial",
  }));

  const res = respuestaFalsa();
  await rutaDe("/api/citas/cancelar")({ body: {} }, res);

  assert.strictEqual(res.codigo, 400);
  assert.strictEqual(espia.mock.callCount(), 0);
});

test("cancela y devuelve el resultado y por donde salio el aviso", async (t) => {
  t.mock.method(organizations, "getDefault", async () => ORG);
  t.mock.method(whatsappGroups, "listSessions", async () => [{ nombre: "RADA-NATALIA", estado: "activa" }]);
  const llamadas = [];
  t.mock.method(cancelarCita, "cancelar", async (org, leadId, opts) => {
    llamadas.push({ org, leadId, opts });
    return { ok: true, resultado: "cancelada", aviso: "linea_natalia" };
  });

  const res = respuestaFalsa();
  await rutaDe("/api/citas/cancelar")(
    { body: { leadId: "lead-1", motivo: "el cliente cambio de planes" } },
    res
  );

  assert.strictEqual(res.codigo, 200);
  assert.strictEqual(res.cuerpo.ok, true);
  assert.strictEqual(res.cuerpo.resultado, "cancelada");
  assert.strictEqual(res.cuerpo.aviso, "linea_natalia");
  assert.strictEqual(llamadas.length, 1);
  assert.strictEqual(llamadas[0].leadId, "lead-1");
  assert.strictEqual(llamadas[0].opts.motivo, "el cliente cambio de planes");
  assert.strictEqual(llamadas[0].opts.sesion, "RADA-NATALIA");
  assert.strictEqual(llamadas[0].org.id, "org-1");
});

test("una cita que no existe responde 404", async (t) => {
  t.mock.method(organizations, "getDefault", async () => ORG);
  t.mock.method(whatsappGroups, "listSessions", async () => []);
  t.mock.method(cancelarCita, "cancelar", async () => ({
    ok: false, resultado: "no_encontrada", aviso: null,
  }));

  const res = respuestaFalsa();
  await rutaDe("/api/citas/cancelar")({ body: { leadId: "lead-fantasma" } }, res);

  assert.strictEqual(res.codigo, 404);
});

// HALLAZGO 4 (review 2026-09-04): reprogramar no tenia la guarda simetrica a
// la de cancelar y revivia una cita cancelada. Ahora el modulo devuelve
// `esta_cancelada`; la ruta tiene que traducirlo a un 409 con un mensaje que
// se entienda, no dejarlo caer al 200 generico como si se hubiera movido.
test("reprogramar una cita cancelada responde 409 y no dice que se movio", async (t) => {
  t.mock.method(organizations, "getDefault", async () => ORG);
  t.mock.method(whatsappGroups, "listSessions", async () => []);
  t.mock.method(cancelarCita, "reprogramar", async () => ({
    ok: false, resultado: "esta_cancelada", aviso: null,
  }));

  const res = respuestaFalsa();
  await rutaDe("/api/citas/reprogramar")(
    { body: { leadId: "lead-1", nuevaFechaHora: "2026-09-11T10:00:00-05:00" } },
    res
  );

  assert.strictEqual(res.codigo, 409);
  assert.match(res.cuerpo.error, /cancelada/i);
  assert.ok(!res.cuerpo.ok, "no puede parecer un exito");
});

test("exige la x-api-key como el resto de /api", async (t) => {
  config.botApiKey = "clave-de-prueba";
  t.mock.method(organizations, "getDefault", async () => ORG);
  t.mock.method(whatsappGroups, "listSessions", async () => []);
  t.mock.method(cancelarCita, "cancelar", async () => ({
    ok: true, resultado: "cancelada", aviso: "oficial",
  }));

  const express = require("express");
  const app = express();
  app.use(express.json());
  app.use(router);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;

  const sinKey = await fetch(`http://127.0.0.1:${port}/api/citas/cancelar`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ leadId: "lead-1" }),
  });
  assert.strictEqual(sinKey.status, 401);

  const conKey = await fetch(`http://127.0.0.1:${port}/api/citas/cancelar`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "clave-de-prueba" },
    body: JSON.stringify({ leadId: "lead-1" }),
  });
  assert.strictEqual(conKey.status, 200);
});
