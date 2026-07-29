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

// ══ Listado de grupos ════════════════════════════════════════════════════

function mockGrupos(payload) {
  mock.method(globalThis, "fetch", async () => ({
    ok: true,
    headers: new Map([["content-type", "application/json"]]),
    text: async () => JSON.stringify(payload),
  }));
}

test("BUG: el nombre del grupo viaja en claves distintas según el motor", async () => {
  // WEBJS usa `name`, NOWEB tiende a `subject`, y algunas versiones lo anidan.
  // Buscar en un solo lugar deja una lista de "Grupo sin nombre" que el usuario
  // no puede administrar: no sabe cuál apagar.
  mockGrupos([
    { id: "1@g.us", name: "Con name" },
    { id: "2@g.us", subject: "Con subject" },
    { id: "3@g.us", groupMetadata: { subject: "Anidado" } },
    { id: "4@g.us", _data: { subject: "En _data" } },
  ]);
  const g = await waha.listarGrupos("s");
  assert.deepStrictEqual(g.map((x) => x.nombre), ["Con name", "Con subject", "Anidado", "En _data"]);
});

test("el jid se lee tanto plano como serializado", async () => {
  mockGrupos([
    { id: "120363@g.us", subject: "Plano" },
    { id: { _serialized: "120364@g.us" }, subject: "Serializado" },
    { jid: "120365@g.us", subject: "En jid" },
  ]);
  const g = await waha.listarGrupos("s");
  assert.deepStrictEqual(g.map((x) => x.jid), ["120363@g.us", "120364@g.us", "120365@g.us"]);
});

test("lo que no sea un grupo se descarta", async () => {
  mockGrupos([
    { id: "120363@g.us", subject: "Grupo" },
    { id: "573001234567@c.us", subject: "Un contacto, no un grupo" },
    { id: null },
  ]);
  const g = await waha.listarGrupos("s");
  assert.strictEqual(g.length, 1);
});

test("acepta el listado envuelto en data o groups, no sólo array pelado", async () => {
  mockGrupos({ data: [{ id: "1@g.us", subject: "A" }] });
  assert.strictEqual((await waha.listarGrupos("s")).length, 1);
  mockGrupos({ groups: [{ id: "2@g.us", subject: "B" }] });
  assert.strictEqual((await waha.listarGrupos("s")).length, 1);
});

test("si ninguno trae nombre, se registran las CLAVES — nunca los valores", async () => {
  // Los nombres de los grupos son datos de terceros: al log van las claves para
  // poder corregir el parseo, jamás su contenido.
  const avisos = [];
  mock.method(console, "warn", (...a) => avisos.push(a.join(" ")));
  mockGrupos([{ id: "1@g.us", tituloRaro: "Inmobiliarias Medellín" }]);
  await waha.listarGrupos("s");
  const texto = avisos.join("\n");
  assert.match(texto, /tituloRaro/, "debería decir qué claves hay");
  assert.ok(!texto.includes("Inmobiliarias Medellín"), "no puede filtrar el nombre real al log");
});

test("con nombres presentes no se registra ninguna advertencia", async () => {
  const avisos = [];
  mock.method(console, "warn", (...a) => avisos.push(a.join(" ")));
  mockGrupos([{ id: "1@g.us", subject: "Todo bien" }]);
  await waha.listarGrupos("s");
  assert.deepStrictEqual(avisos, []);
});

test("si el listado no trae nombres, se piden los grupos de a uno", async () => {
  // Una lista de "Grupo sin nombre" no se puede administrar: el usuario no
  // sabe cuál apagar. El listado masivo de algunas versiones de WAHA no expone
  // la metadata, pero el detalle individual sí.
  const pedidos = [];
  mock.method(globalThis, "fetch", async (url) => {
    const u = String(url);
    pedidos.push(u);
    const body = u.endsWith("/groups")
      ? [{ id: "1@g.us" }, { id: "2@g.us" }]
      : { id: u.split("/").pop(), subject: `Nombre de ${u.split("/").pop()}` };
    return { ok: true, headers: new Map([["content-type", "application/json"]]), text: async () => JSON.stringify(body) };
  });

  const g = await waha.listarGrupos("s");
  assert.deepStrictEqual(g.map((x) => x.nombre), ["Nombre de 1%40g.us", "Nombre de 2%40g.us"]);
  assert.strictEqual(pedidos.length, 3, "uno masivo + uno por grupo");
});

test("si falla el detalle de un grupo, los demás igual se completan", async () => {
  mock.method(globalThis, "fetch", async (url) => {
    const u = String(url);
    if (u.endsWith("/groups")) {
      return { ok: true, headers: new Map([["content-type", "application/json"]]), text: async () => JSON.stringify([{ id: "1@g.us" }, { id: "2@g.us" }]) };
    }
    if (u.includes("1%40g.us")) return { ok: false, status: 500, headers: new Map(), text: async () => "" };
    return { ok: true, headers: new Map([["content-type", "application/json"]]), text: async () => JSON.stringify({ subject: "El segundo sí" }) };
  });

  const g = await waha.listarGrupos("s");
  assert.strictEqual(g[0].nombre, null);
  assert.strictEqual(g[1].nombre, "El segundo sí");
});

test("si el listado YA trae nombres no se piden de a uno", async () => {
  const pedidos = [];
  mock.method(globalThis, "fetch", async (url) => {
    pedidos.push(String(url));
    return { ok: true, headers: new Map([["content-type", "application/json"]]), text: async () => JSON.stringify([{ id: "1@g.us", subject: "Ya tiene" }]) };
  });
  await waha.listarGrupos("s");
  assert.strictEqual(pedidos.length, 1, "no hay que gastar una llamada por grupo si ya vinieron");
});

// ══ Recuperar una sesión caída ═══════════════════════════════════════════

test("una sesión en FAILED se reinicia, no se deja como está", async () => {
  // Reaplicar la config no arregla una sesión caída. Sin reiniciar, el único
  // camino visible era volver a molestar al asesor con el QR — y muchas veces
  // no hace falta: las credenciales siguen en el volumen.
  const rutas = [];
  mock.method(globalThis, "fetch", async (url, opts) => {
    const u = String(url);
    rutas.push(`${opts?.method || "GET"} ${u.replace("http://waha.test:8080", "")}`);
    if (u.endsWith("/api/sessions") && opts?.method === "POST") {
      return { ok: false, status: 422, headers: new Map(), text: async () => "{}" };
    }
    const cuerpo = rutas.some((r) => r.includes("/restart")) ? { status: "STARTING" } : { status: "FAILED" };
    return { ok: true, headers: new Map([["content-type", "application/json"]]), text: async () => JSON.stringify(cuerpo) };
  });

  const r = await waha.crearSesion("s", { webhookUrl: "http://bot/w", webhookSecret: "x" });
  assert.ok(rutas.some((x) => x === "POST /api/sessions/s/restart"), `no reinició. Rutas: ${rutas.join(" | ")}`);
  assert.strictEqual(r.status, "STARTING");
});

test("BUG: re-vincular hace logout, no restart — restart reintenta con las credenciales rechazadas", async () => {
  // El 2026-07-28 la línea de Natalia murió así: WhatsApp dejó de aceptar el
  // dispositivo, y los 31 intentos de login fallaron con "Connection Failure"
  // hasta que WAHA se rindió. Con `restart` esto no se recupera nunca, porque
  // reintenta con las MISMAS credenciales que WhatsApp está rechazando.
  // `logout` las borra; `restart` las conserva. Es toda la diferencia.
  const rutas = [];
  mock.method(globalThis, "fetch", async (url, opts) => {
    const u = String(url).replace("http://waha.test:8080", "");
    rutas.push(`${opts?.method || "GET"} ${u}`);
    const cuerpo = u.includes("/logout") || u.includes("/start") ? {} : { status: "SCAN_QR_CODE" };
    return { ok: true, headers: new Map([["content-type", "application/json"]]), text: async () => JSON.stringify(cuerpo) };
  });

  const r = await waha.revincular("natalia");
  assert.ok(rutas.includes("POST /api/sessions/natalia/logout"), `no hizo logout. Rutas: ${rutas.join(" | ")}`);
  assert.ok(!rutas.some((x) => x.includes("/restart")), "restart NO sirve acá: conserva las credenciales rechazadas");
  assert.ok(
    rutas.indexOf("POST /api/sessions/natalia/logout") < rutas.indexOf("POST /api/sessions/natalia/start"),
    "primero se borran las credenciales y después se arranca, si no vuelve a levantar con las viejas"
  );
  assert.strictEqual(r.status, "SCAN_QR_CODE", "tiene que quedar pidiendo el QR");
});

test("re-vincular sobrevive a un 422 al arrancar — WAHA a veces la levanta sola", async () => {
  mock.method(globalThis, "fetch", async (url, opts) => {
    const u = String(url);
    if (u.includes("/start")) return { ok: false, status: 422, headers: new Map(), text: async () => "{}" };
    return {
      ok: true,
      headers: new Map([["content-type", "application/json"]]),
      text: async () => JSON.stringify(u.includes("/logout") ? {} : { status: "SCAN_QR_CODE" }),
    };
  });
  assert.strictEqual((await waha.revincular("natalia")).status, "SCAN_QR_CODE");
});

test("si el logout falla, NO se sigue adelante", async () => {
  // Seguir arrancaría la sesión con las credenciales viejas y la dejaría otra
  // vez en FAILED, pero con el asesor mirando un QR que nunca llega.
  mock.method(globalThis, "fetch", async (url) =>
    String(url).includes("/logout")
      ? { ok: false, status: 500, headers: new Map(), text: async () => "{}" }
      : { ok: true, headers: new Map(), text: async () => "{}" }
  );
  await assert.rejects(() => waha.revincular("natalia"), /500/);
});

test("una sesión sana NO se reinicia — reiniciar de más corta la escucha", async () => {
  const rutas = [];
  mock.method(globalThis, "fetch", async (url, opts) => {
    const u = String(url);
    rutas.push(`${opts?.method || "GET"} ${u}`);
    if (u.endsWith("/api/sessions") && opts?.method === "POST") {
      return { ok: false, status: 422, headers: new Map(), text: async () => "{}" };
    }
    return { ok: true, headers: new Map([["content-type", "application/json"]]), text: async () => JSON.stringify({ status: "WORKING" }) };
  });

  await waha.crearSesion("s", { webhookUrl: "http://bot/w", webhookSecret: "x" });
  assert.ok(!rutas.some((x) => x.includes("/restart")), "no debería reiniciar una sesión que está funcionando");
});
