// DM a un destino @lid (bloque 2, 2026-09-03).
//
// La pregunta de Juan: "como podemos hacer para que ese link lleve directo al
// dm del colega". Sin numero no hay link; lo que puede haber es un envio por
// la linea vinculada al identificador oculto. Esto fija que ese camino exista
// SOLO cuando se pide a proposito, y que la guarda de siempre siga intacta.
const { test } = require("node:test");
const assert = require("node:assert");
const waha = require("../src/lib/waha");

const ENV = { WAHA_URL: process.env.WAHA_URL, WAHA_API_KEY: process.env.WAHA_API_KEY };
const fetchReal = globalThis.fetch;

function conWaha(respuesta) {
  process.env.WAHA_URL = "http://waha.test:8080";
  process.env.WAHA_API_KEY = "clave-de-prueba";
  const llamadas = [];
  globalThis.fetch = async (url, init) => {
    llamadas.push({ url: String(url), metodo: (init && init.method) || "GET", body: init && init.body ? JSON.parse(init.body) : null });
    const { status = 200, cuerpo = {} } = respuesta;
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(cuerpo) };
  };
  return llamadas;
}
function restaurar() {
  globalThis.fetch = fetchReal;
  process.env.WAHA_URL = ENV.WAHA_URL || "";
  process.env.WAHA_API_KEY = ENV.WAHA_API_KEY || "";
}

test("con { lid }, el DM sale a <lid>@lid por sendText", async () => {
  const llamadas = conWaha({ cuerpo: { id: { _serialized: "true_269230108872829@lid_ABC" } } });
  try {
    const r = await waha.enviarDm("RADA-NATALIA", null, "hola", { lid: "269230108872829@lid", orgId: "org-1" });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.destino, "269230108872829@lid");
    assert.strictEqual(r.wamid, "true_269230108872829@lid_ABC");
    assert.strictEqual(llamadas.length, 1);
    assert.match(llamadas[0].url, /\/api\/sendText$/);
    assert.deepStrictEqual(llamadas[0].body, { session: "RADA-NATALIA", chatId: "269230108872829@lid", text: "hola" });
  } finally {
    restaurar();
  }
});

test("sin { lid }, un lid en el lugar del telefono SIGUE rechazado — la guarda no se movio", async () => {
  const llamadas = conWaha({ cuerpo: {} });
  try {
    const r = await waha.enviarDm("RADA-NATALIA", "269230108872829", "hola");
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /Destino invalido/);
    assert.strictEqual(llamadas.length, 0, "no se le pregunto nada a la red");
  } finally {
    restaurar();
  }
});

test("un lid demasiado corto se rechaza antes de tocar la red", async () => {
  const llamadas = conWaha({ cuerpo: {} });
  try {
    const r = await waha.enviarDm("RADA-NATALIA", null, "hola", { lid: "123" });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(llamadas.length, 0);
  } finally {
    restaurar();
  }
});

test("si WAHA rechaza el lid, se dice previoAlEnvio para que quien llame decida", async () => {
  conWaha({ status: 422, cuerpo: { message: "chatId not found" } });
  try {
    const r = await waha.enviarDm("RADA-NATALIA", null, "hola", { lid: "269230108872829", orgId: "org-1" });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.previoAlEnvio, true);
    assert.match(r.error, /chatId not found/);
  } finally {
    restaurar();
  }
});

test("versionInfo es solo lectura y no revienta si WAHA no responde", async () => {
  const llamadas = conWaha({ cuerpo: { version: "2026.8.1", engine: "WEBJS", tier: "PLUS" } });
  try {
    const v = await waha.versionInfo();
    assert.strictEqual(v.version, "2026.8.1");
    assert.strictEqual(v.engine, "WEBJS");
    assert.strictEqual(llamadas[0].metodo, "GET");
    assert.match(llamadas[0].url, /\/api\/version$/);
  } finally {
    restaurar();
  }
  conWaha({ status: 500, cuerpo: { message: "boom" } });
  try {
    const v = await waha.versionInfo();
    assert.strictEqual(v.version, null);
    assert.match(v.error, /boom/);
  } finally {
    restaurar();
  }
});

// ── EL CANDADO (Juan, 2026-09-10) ────────────────────────────────────────
// enviarDm es la unica puerta de los DM: aca se revisa, por ultima vez, que el
// destino no sea un colega marcado "solo llamada" — sea por lid o por
// telefono. Asi ni un camino nuevo ni el endpoint de prueba la esquivan.
const memory = require("../src/data/memory");
const colegasData = require("../src/data/colegas");

test("a un colega marcado no le sale nada, ni por lid ni por telefono", async () => {
  memory.colegasGrupos.push({ id: "c1", org_id: "org-1", lid: "269230108872829", telefono: "573146399667", nombre: "X", grupos: [], solo_llamada: true });
  const llamadas = conWaha({ cuerpo: {} });
  try {
    const porLid = await waha.enviarDm("RADA-NATALIA", null, "hola", { lid: "269230108872829", orgId: "org-1" });
    const porTel = await waha.enviarDm("RADA-NATALIA", "573146399667", "hola", { orgId: "org-1" });
    assert.strictEqual(porLid.ok, false);
    assert.strictEqual(porLid.error, "colega_solo_llamada");
    assert.strictEqual(porLid.previoAlEnvio, false, "nadie debe reintentar por la otra via");
    assert.strictEqual(porTel.error, "colega_solo_llamada");
    assert.strictEqual(llamadas.length, 0, "no se toco la red");
  } finally {
    restaurar();
    memory.colegasGrupos.length = 0;
  }
});

test("si no se puede verificar la marca, no sale (falla cerrado)", async (t) => {
  t.mock.method(colegasData, "esSoloLlamada", async () => null);
  const llamadas = conWaha({ cuerpo: {} });
  try {
    const r = await waha.enviarDm("RADA-NATALIA", "573001234567", "hola", { orgId: "org-1" });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, "colega_solo_llamada");
    assert.strictEqual(llamadas.length, 0);
  } finally {
    restaurar();
  }
});

test("sin orgId no se puede verificar al destinatario: no sale", async () => {
  const llamadas = conWaha({ cuerpo: {} });
  try {
    const r = await waha.enviarDm("RADA-NATALIA", "573001234567", "hola");
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /orgId/);
    assert.strictEqual(llamadas.length, 0);
  } finally {
    restaurar();
  }
});
