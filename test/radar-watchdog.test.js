// El vigilante del radar.
//
// Los fallos de este ecosistema son silenciosos: el baneo del 2026-07-30 se
// descubrio porque Juan abrio una pantalla, DMAP estuvo 16 dias detenido sin que
// nadie se enterara, y el sync de Wasi se salteo cinco dias seguidos en agosto
// sin dejar mas rastro que un hueco en una tabla.
//
// Con el reintento manual, una sesion caida ya no se levanta sola: sin este
// aviso el radar queda mudo hasta que alguien se acuerde de mirar.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const RUTA = (m) => require.resolve(path.join("..", "src", m));

let sesiones = [];
let estadosWaha = {};
let inventario = { fresco: true, iso: new Date().toISOString(), horas: 1 };
let enviados = [];
let gruposEnabled = true;
let problemasSalud = [];

function instalar() {
  require.cache[RUTA("data/organizations.js")] = {
    exports: { getDefault: async () => ({ id: "org-1", name: "Diamond" }) },
  };
  require.cache[RUTA("data/whatsapp-groups.js")] = {
    exports: { listSessions: async () => sesiones },
  };
  require.cache[RUTA("data/sync-estado.js")] = {
    exports: { estadoDelInventario: async () => inventario },
  };
  require.cache[RUTA("lib/waha.js")] = {
    exports: {
      configurado: () => true,
      estadoSesion: async (n) => estadosWaha[n] || { status: "WORKING" },
    },
  };
  require.cache[RUTA("channels/whatsapp.js")] = {
    exports: {
      sendWhatsApp: async (org, to, texto) => {
        enviados.push({ to, texto });
        return { ok: true, wamid: "w" };
      },
    },
  };
  require.cache[RUTA("data/salud.js")] = {
    exports: { problemas: async () => problemasSalud },
  };
  require.cache[RUTA("config.js")] = {
    exports: { groups: { enabled: gruposEnabled }, supabaseUrl: "x" },
  };
  delete require.cache[RUTA("scheduler/radar-watchdog.js")];
  process.env.RADAR_WATCHDOG_TO = "573001112233";
  return require("../src/scheduler/radar-watchdog");
}

let wd;
beforeEach(() => {
  sesiones = [{ nombre: "radar-linea" }];
  estadosWaha = {};
  inventario = { fresco: true, iso: new Date().toISOString(), horas: 1 };
  enviados = [];
  problemasSalud = [];
  gruposEnabled = true;
  wd = instalar();
});

test("con todo sano no avisa nada", async () => {
  const problemas = await wd.revisar();
  assert.deepStrictEqual(problemas, []);
  await wd.avisar(problemas);
  assert.deepStrictEqual(enviados, []);
});

test("una sesion caida se reporta y dice que hacer", async () => {
  estadosWaha["radar-linea"] = { status: "FAILED" };
  const problemas = await wd.revisar();
  assert.strictEqual(problemas.length, 1);
  assert.match(problemas[0].texto, /dejo de escuchar/);
  // El aviso tiene que decir el siguiente paso: ya no se levanta sola.
  assert.match(problemas[0].texto, /Reintentar una vez/);
});

test("STOPPED y ERROR tambien cuentan como caida", async () => {
  estadosWaha["radar-linea"] = { status: "STOPPED" };
  assert.strictEqual((await wd.revisar()).length, 1);
  estadosWaha["radar-linea"] = { status: "ERROR" };
  assert.strictEqual((await wd.revisar()).length, 1);
  estadosWaha["radar-linea"] = { status: "WORKING" };
  assert.strictEqual((await wd.revisar()).length, 0);
});

test("con el radar apagado, que no haya sesion no es noticia", async () => {
  // Si la escucha en vivo esta apagada, avisar seria ruido diario.
  gruposEnabled = false;
  wd = instalar();
  estadosWaha["radar-linea"] = { status: "STOPPED" };
  assert.deepStrictEqual(await wd.revisar(), []);
});

test("el inventario viejo se reporta aunque el radar este apagado", async () => {
  // Un inventario detenido tambien ensucia la landing y lo que Sofi le ofrece a
  // un cliente, no solo los grupos.
  gruposEnabled = false;
  wd = instalar();
  inventario = { fresco: false, iso: "2026-08-15T00:00:00Z", horas: 41.7 };
  const problemas = await wd.revisar();
  assert.strictEqual(problemas.length, 1);
  assert.match(problemas[0].texto, /41\.7 h/);
  assert.match(problemas[0].texto, /no va a publicar nada/);
});

test("si no se puede leer el estado del sync, tambien avisa", async () => {
  inventario = { fresco: false, iso: null, horas: null };
  const problemas = await wd.revisar();
  assert.match(problemas[0].texto, /No se pudo leer/);
});

test("el aviso sale por la linea oficial de Sofi", async () => {
  // Nunca por la vinculada: si lo que se cayo es esa linea, avisar por ahi seria
  // pedirle al muerto que avise de su muerte.
  inventario = { fresco: false, iso: "2026-08-15T00:00:00Z", horas: 50 };
  await wd.avisar(await wd.revisar());
  assert.strictEqual(enviados.length, 1);
  assert.strictEqual(enviados[0].to, "573001112233");
  assert.match(enviados[0].texto, /^⚠️/);
});

test("no repite el mismo aviso en cada revision", async () => {
  inventario = { fresco: false, iso: "2026-08-15T00:00:00Z", horas: 50 };
  await wd.avisar(await wd.revisar());
  await wd.avisar(await wd.revisar());
  await wd.avisar(await wd.revisar());
  assert.strictEqual(enviados.length, 1, "media hora tras media hora, seria spam");
});

test("cuando se normaliza, avisa que se normalizo", async () => {
  // Sin esto, quien recibio la alarma no sabe nunca que puede dejar de
  // preocuparse — y termina ignorando las alarmas.
  inventario = { fresco: false, iso: "2026-08-15T00:00:00Z", horas: 50 };
  await wd.avisar(await wd.revisar());
  inventario = { fresco: true, iso: new Date().toISOString(), horas: 1 };
  await wd.avisar(await wd.revisar());
  assert.strictEqual(enviados.length, 2);
  assert.match(enviados[1].texto, /se normalizo/);
});

test("sin destinatario configurado no arranca", async () => {
  // Un vigilante que no tiene a quien llamar no es un vigilante: mejor que sea
  // evidente al arrancar y no el dia que haga falta.
  delete process.env.RADAR_WATCHDOG_TO;
  delete require.cache[RUTA("scheduler/radar-watchdog.js")];
  const sinDestino = require("../src/scheduler/radar-watchdog");
  assert.strictEqual(sinDestino.start(), null);
  process.env.RADAR_WATCHDOG_TO = "573001112233";
});

test("el watchdog no intenta arreglar nada", () => {
  // Detecta y avisa. Levantar la sesion es decision de una persona.
  const fs = require("node:fs");
  const fuente = fs
    .readFileSync(path.join(__dirname, "..", "src", "scheduler", "radar-watchdog.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  for (const p of ["reintentarUnaVez", "revincular", "crearSesion", "restart"]) {
    assert.ok(!fuente.includes(p), `el watchdog no puede llamar a ${p}`);
  }
});

// Los chequeos de salud (src/data/salud.js) entran por el mismo camino que la
// sesion y el sync: misma deduplicacion, mismo "se normalizo".
test("los problemas de salud se avisan una vez y se anuncia cuando se normalizan", async () => {
  wd = instalar();
  problemasSalud = [{ clave: "ventana:573028536489", texto: "La ventana de Catherine cierra en 3 h." }];

  await wd.avisar(await wd.revisar());
  await wd.avisar(await wd.revisar());
  assert.strictEqual(enviados.filter((e) => e.texto.includes("Catherine")).length, 1, "no se repite cada media hora");

  problemasSalud = [];
  await wd.avisar(await wd.revisar());
  assert.ok(enviados.some((e) => e.texto.includes("se normalizo") && e.texto.includes("ventana:573028536489")));
});
