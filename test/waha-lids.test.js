// Resolver el LID de un colega a su telefono.
//
// POR QUE EXISTE. WhatsApp ya no expone el numero de los participantes de un
// grupo: manda un LID (identificador oculto). Lo que el radar venia guardando en
// `group_signals.autor_telefono` son LIDs, no telefonos — 14 a 17 digitos contra
// los 12 de un movil colombiano (12 de 12 en las senales reales del 2026-08-22).
//
// Sin resolver eso, "responderle al interno al colega" (Juan, 2026-08-22) no
// tiene a donde escribir. Este modulo es solo la MEDICION de si es posible: la
// doc de WAHA advierte que la resolucion falla cuando el numero no esta en los
// contactos de la linea o cuando la linea no es admin del grupo, y Natalia es
// miembro.
//
// Lo que estas pruebas fijan: que resolver sea SOLO LECTURA, que un LID
// desconocido devuelva null en vez de reventar el flujo, y que no se le pregunte
// nada a la red cuando no hay nada que preguntar.

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const waha = require("../src/lib/waha");

const ENV = { WAHA_URL: process.env.WAHA_URL, WAHA_API_KEY: process.env.WAHA_API_KEY };
const fetchReal = globalThis.fetch;

function conWaha(respuesta) {
  process.env.WAHA_URL = "http://waha.test:8080";
  process.env.WAHA_API_KEY = "clave-de-prueba";
  const llamadas = [];
  globalThis.fetch = async (url, init) => {
    llamadas.push({ url: String(url), metodo: (init && init.method) || "GET" });
    const { status = 200, cuerpo = {} } = respuesta;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(cuerpo),
    };
  };
  return llamadas;
}

function restaurar() {
  globalThis.fetch = fetchReal;
  process.env.WAHA_URL = ENV.WAHA_URL || "";
  process.env.WAHA_API_KEY = ENV.WAHA_API_KEY || "";
}

test("resuelve el lid al telefono, en digitos y sin el sufijo de WhatsApp", async () => {
  const llamadas = conWaha({ cuerpo: { pn: "573001234567@c.us" } });
  try {
    assert.strictEqual(await waha.telefonoDeLid("RADA-NATALIA", "198161251463188"), "573001234567");
    assert.strictEqual(llamadas.length, 1);
    assert.match(llamadas[0].url, /\/api\/RADA-NATALIA\/lids\/198161251463188$/);
    // Consultar no puede escribir: si esto deja de ser un GET, algo cambio de naturaleza.
    assert.strictEqual(llamadas[0].metodo, "GET");
  } finally {
    restaurar();
  }
});

test("acepta las variantes de nombre del campo segun la version de WAHA", async () => {
  for (const cuerpo of [{ phoneNumber: "573001234567" }, { phone: "57 300 123 4567" }]) {
    conWaha({ cuerpo });
    try {
      assert.strictEqual(await waha.telefonoDeLid("s", "1981612514"), "573001234567");
    } finally {
      restaurar();
    }
  }
});

test("un lid que WAHA no conoce da null, no una excepcion", async () => {
  // Es el caso ESPERADO, no un error: pasa siempre que el numero no este en los
  // contactos de la linea y la linea no sea admin del grupo.
  conWaha({ status: 404, cuerpo: { message: "not found" } });
  try {
    assert.strictEqual(await waha.telefonoDeLid("s", "198161251463188"), null);
  } finally {
    restaurar();
  }
});

test("un fallo del servidor tampoco tumba el flujo", async () => {
  conWaha({ status: 500, cuerpo: { message: "boom" } });
  try {
    assert.strictEqual(await waha.telefonoDeLid("s", "198161251463188"), null);
  } finally {
    restaurar();
  }
});

test("una respuesta vacia da null, no una cadena vacia", async () => {
  conWaha({ cuerpo: { pn: null } });
  try {
    assert.strictEqual(await waha.telefonoDeLid("s", "198161251463188"), null);
  } finally {
    restaurar();
  }
});

test("sin sesion o sin lid no se le pregunta nada a la red", async () => {
  const llamadas = conWaha({ cuerpo: { pn: "573001234567" } });
  try {
    assert.strictEqual(await waha.telefonoDeLid("", "198161251463188"), null);
    assert.strictEqual(await waha.telefonoDeLid("s", null), null);
    assert.strictEqual(await waha.telefonoDeLid("s", "sin-digitos"), null);
    assert.strictEqual(llamadas.length, 0);
  } finally {
    restaurar();
  }
});

test("contarLids devuelve el numero, y null si no se pudo saber", async () => {
  conWaha({ cuerpo: { count: 42 } });
  try {
    assert.strictEqual(await waha.contarLids("s"), 42);
  } finally {
    restaurar();
  }
  conWaha({ status: 500, cuerpo: {} });
  try {
    assert.strictEqual(await waha.contarLids("s"), null);
  } finally {
    restaurar();
  }
});

test("resolver un lid NO abre una segunda via de envio", () => {
  // La guarda de `enviarTexto` (solo @g.us) es lo que hoy impide escribirle por
  // error al privado de un colega, y sigue siendo la unica puerta de salida.
  // Este archivo agrega lectura; el dia que alguien convierta esto en un envio,
  // que se note aca.
  const fuente = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "waha.js"), "utf8");
  const cuerpoDeLids = fuente.slice(fuente.indexOf("async function telefonoDeLid"));
  for (const prohibido of ["/api/sendText", "sendText", "metodo: \"POST\""]) {
    assert.ok(
      !cuerpoDeLids.includes(prohibido),
      `La resolucion de lids no puede enviar nada, y contiene "${prohibido}"`
    );
  }
});

// EL FALLBACK SOLO ES PARA UN 404 (Juan, 2026-09-04).
//
// participantesDeGrupo intenta /participants/v2 y cae al endpoint viejo si
// falla. Ese fallback existe para una version de WAHA sin /v2 — o sea un 404.
// Pero el catch se tragaba CUALQUIER error y reintentaba igual: un 429 de
// WhatsApp ("rate-overlimit") disparaba una segunda peticion en el mismo
// instante. Medido en produccion: 62 peticiones por vuelta en vez de 31, y el
// calentamiento termino con CERO participantes resueltos.
test("un error que NO es 404 corta: no se reintenta contra el endpoint viejo", async () => {
  process.env.WAHA_URL = "http://waha.test";
  process.env.WAHA_API_KEY = "k";
  const rutas = [];
  globalThis.fetch = async (url) => {
    rutas.push(String(url));
    return { ok: false, status: 500, text: async () => JSON.stringify({ message: "rate-overlimit" }) };
  };
  const waha = require("../src/lib/waha");
  const r = await waha.participantesDeGrupo("S", "123@g.us");
  assert.deepStrictEqual(r, []);
  assert.strictEqual(rutas.length, 1, `con un 500 se pide UNA sola vez, se pidieron ${rutas.length}: ${rutas.join(" ")}`);
});

test("un 404 SI cae al endpoint viejo: es para eso que existe el fallback", async () => {
  process.env.WAHA_URL = "http://waha.test";
  process.env.WAHA_API_KEY = "k";
  const rutas = [];
  globalThis.fetch = async (url) => {
    rutas.push(String(url));
    if (rutas.length === 1) return { ok: false, status: 404, text: async () => "{}" };
    return { ok: true, status: 200, text: async () => JSON.stringify([{ id: "123@lid", pn: "573001234567" }]) };
  };
  const waha = require("../src/lib/waha");
  const r = await waha.participantesDeGrupo("S", "123@g.us");
  assert.strictEqual(rutas.length, 2, "el 404 tiene que probar el endpoint viejo");
  assert.strictEqual(r[0].telefono, "573001234567");
});
