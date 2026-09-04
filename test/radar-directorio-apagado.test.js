// El calentamiento del directorio arranca APAGADO (Juan, 2026-09-04).
//
// Literal: "quiero es que lo apaguemos, no quiero nada que genere riesgo".
// Ese dia el calentamiento pidio los participantes de los 31 grupos y
// WhatsApp respondio rate-overlimit (429) a todas: "31/31 grupos, 0 pares, 0
// colegas completados". Es el unico trabajo del bot que genera trafico
// sostenido contra WhatsApp sin que nadie lo haya pedido, y la linea del
// radar ya fue baneada una vez (2026-07-30).
//
// El modulo NO se borra: si WhatsApp afloja, esto se vuelve a encender con
// una variable de entorno y sin tocar codigo. Por eso el interruptor se lee
// en cada `start()`, no al cargar el modulo.

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const RUTA = (m) => require.resolve(path.join("..", "src", m));

let calentamientos = [];
// Toda instancia creada en un test se apaga en el afterEach: un `start()` que
// queda vivo deja un setInterval de 60 min y el runner nunca termina. Pasa
// justo cuando una asercion falla antes del stop(), que es el caso que este
// archivo provoca a proposito mientras el interruptor no existe.
let instancias = [];

function instalar() {
  // WAHA configurado y una org activa: asi, si el scheduler arrancara, seria
  // por decision propia y no porque el entorno se lo impida. Lo que este
  // archivo prueba es el interruptor, no las otras guardas.
  require.cache[RUTA("lib/waha.js")] = { exports: { configurado: () => true } };
  require.cache[RUTA("data/organizations.js")] = {
    exports: { listActive: async () => [{ id: "org-1", name: "Diamond" }] },
  };
  require.cache[RUTA("data/whatsapp-groups.js")] = {
    exports: {
      listSessions: async () => [{ nombre: "RADA-NATALIA", estado: "activa" }],
      listGroups: async () => [{ jid: "123@g.us", modo: "asistido" }],
    },
  };
  require.cache[RUTA("groups/directorio.js")] = {
    exports: {
      calentar: async (orgId, sesion, jids) => {
        calentamientos.push({ orgId, sesion, jids });
        return { grupos: jids.length, refrescados: 0, pares: 0, indice: 0 };
      },
      rellenarColegas: async () => 0,
    },
  };
  delete require.cache[RUTA("scheduler/radar-directorio.js")];
  const scheduler = require("../src/scheduler/radar-directorio");
  instancias.push(scheduler);
  return scheduler;
}

// console.log capturado: el pedido explicito es que `start()` diga POR QUE no
// arranca. Un apagado silencioso es como se pierde una funcion sin que nadie
// se entere (es el hallazgo #4 del informe de arranque, 2026-09-02).
function conLog(fn) {
  const real = console.log;
  const lineas = [];
  console.log = (...args) => lineas.push(args.join(" "));
  try {
    return { resultado: fn(), lineas };
  } finally {
    console.log = real;
  }
}

beforeEach(() => {
  calentamientos = [];
  delete process.env.RADAR_DIRECTORIO_CALENTAR_ENABLED;
});

afterEach(() => {
  for (const s of instancias) s.stop();
  instancias = [];
  delete process.env.RADAR_DIRECTORIO_CALENTAR_ENABLED;
});

test("sin el interruptor, start() no arranca nada y dice por que", () => {
  const scheduler = instalar();
  const { resultado, lineas } = conLog(() => scheduler.start());
  try {
    assert.strictEqual(resultado, null, "start() no puede devolver un timer con el calentamiento apagado");
    const dicho = lineas.join(" | ");
    assert.match(dicho, /RADAR_DIRECTORIO_CALENTAR_ENABLED/, "el log tiene que nombrar la perilla que lo enciende");
    assert.match(dicho, /apagad/i, "y decir que esta apagado, no solo mencionarla");
  } finally {
    scheduler.stop();
  }
});

test("el interruptor en cualquier valor que no sea un si explicito deja todo apagado", () => {
  const scheduler = instalar();
  for (const valor of ["", "0", "false", "no", "off", "quizas"]) {
    process.env.RADAR_DIRECTORIO_CALENTAR_ENABLED = valor;
    const { resultado } = conLog(() => scheduler.start());
    scheduler.stop();
    assert.strictEqual(resultado, null, `"${valor}" no puede encender el calentamiento`);
  }
});

test("con RADAR_DIRECTORIO_CALENTAR_ENABLED=true si arranca: la decision es reversible sin tocar codigo", () => {
  const scheduler = instalar();
  process.env.RADAR_DIRECTORIO_CALENTAR_ENABLED = "true";
  const { resultado, lineas } = conLog(() => scheduler.start());
  try {
    assert.ok(resultado, "encendido a proposito, tiene que devolver el timer");
    assert.match(lineas.join(" | "), /calentamiento activo/i);
  } finally {
    scheduler.stop();
  }
});

test("el interruptor se lee en cada start(), no al cargar el modulo", () => {
  // Railway reinicia el proceso al cambiar una variable, pero un test (o un
  // futuro comando de admin) tiene que poder encenderlo sin recargar nada.
  const scheduler = instalar();
  assert.strictEqual(conLog(() => scheduler.start()).resultado, null);

  process.env.RADAR_DIRECTORIO_CALENTAR_ENABLED = "1";
  const encendido = conLog(() => scheduler.start()).resultado;
  try {
    assert.ok(encendido, "el mismo modulo ya cargado tiene que poder encenderse");
  } finally {
    scheduler.stop();
  }
});

test("apagado, tick() tampoco sale a pedir participantes", async () => {
  // start() es la puerta normal, pero tick() esta exportado y lo llama
  // cualquiera que quiera forzar una pasada. Con el interruptor apagado, no
  // puede haber trafico contra WhatsApp por ninguna de las dos.
  const scheduler = instalar();
  await scheduler.tick();
  assert.deepStrictEqual(calentamientos, [], "ni una pasada con el calentamiento apagado");
});

test("encendido, tick() si calienta los grupos escuchados", async () => {
  const scheduler = instalar();
  process.env.RADAR_DIRECTORIO_CALENTAR_ENABLED = "true";
  await scheduler.tick();
  assert.strictEqual(calentamientos.length, 1);
  assert.deepStrictEqual(calentamientos[0].jids, ["123@g.us"]);
});
