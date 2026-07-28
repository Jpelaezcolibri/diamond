// El QR del pareo. Es un paso que se hace UNA vez, con el asesor esperando
// delante — que falle ahí cuesta caro en algo que no es tiempo de máquina.
process.env.WAHA_URL = "http://waha.test:8080";
process.env.WAHA_API_KEY = "clave-de-prueba";

const { test, mock, beforeEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const waha = require("../src/lib/waha");

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // cabecera PNG

function mockFetch(respuesta) {
  const llamadas = [];
  mock.method(globalThis, "fetch", async (url, opts) => {
    llamadas.push({ url: String(url), opts });
    return respuesta;
  });
  return llamadas;
}

beforeEach(() => mock.restoreAll());

test("BUG: el QR se pide como imagen, no como texto", async () => {
  // format=raw devuelve el TEXTO del código ("2@abc..."), que metido en un
  // <img> da una imagen rota — sin error, sólo el texto alternativo. Con el
  // asesor esperando delante, eso es lo peor que puede pasar.
  const llamadas = mockFetch({
    ok: true,
    headers: new Map([["content-type", "image/png"]]),
    arrayBuffer: async () => PNG,
  });
  await waha.qr("natalia");
  assert.match(llamadas[0].url, /format=image/);
  assert.ok(!llamadas[0].url.includes("format=raw"), "raw no sirve para mostrar el QR");
});

test("una respuesta binaria se devuelve en base64 lista para el <img>", async () => {
  mockFetch({
    ok: true,
    headers: new Map([["content-type", "image/png"]]),
    arrayBuffer: async () => PNG,
  });
  const b64 = await waha.qr("natalia");
  assert.strictEqual(b64, PNG.toString("base64"));
  // Tiene que reconstruir un PNG válido: los primeros bytes son su firma.
  assert.deepStrictEqual([...Buffer.from(b64, "base64").subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

test("una respuesta JSON {data} también sirve — WAHA cambia según versión", async () => {
  mockFetch({
    ok: true,
    headers: new Map([["content-type", "application/json"]]),
    json: async () => ({ mimetype: "image/png", data: "QUJD" }),
  });
  assert.strictEqual(await waha.qr("natalia"), "QUJD");
});

test("el QR viaja con la API key", async () => {
  const llamadas = mockFetch({
    ok: true,
    headers: new Map([["content-type", "image/png"]]),
    arrayBuffer: async () => PNG,
  });
  await waha.qr("natalia");
  assert.strictEqual(llamadas[0].opts.headers["X-Api-Key"], "clave-de-prueba");
});

test("un error de WAHA se propaga con su status, no devuelve un QR vacío", async () => {
  mockFetch({ ok: false, status: 404, headers: new Map() });
  await assert.rejects(() => waha.qr("inexistente"), /404/);
});

test("el nombre de la sesión se escapa en la URL", async () => {
  const llamadas = mockFetch({
    ok: true,
    headers: new Map([["content-type", "image/png"]]),
    arrayBuffer: async () => PNG,
  });
  await waha.qr("asesor/raro");
  assert.match(llamadas[0].url, /asesor%2Fraro/);
});

test("el cliente de WAHA sigue sin implementar ningún envío", () => {
  const fuente = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "waha.js"), "utf8");
  const codigo = fuente.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const prohibido of ["sendText", "sendImage", "sendFile", "sendVoice", "/api/send"]) {
    assert.ok(!codigo.includes(prohibido), `el cliente de WAHA menciona '${prohibido}'`);
  }
});
