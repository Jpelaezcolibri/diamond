// Guarda de red — punto 1 de la revision final de fase1-directorio-colegas
// (Juan, 2026-08-24).
//
// Historia: en esta sola rama, CUATRO corridas de test salieron a la Supabase
// o WAHA reales (el .env local trae credenciales de produccion y config.js
// las carga con dotenv({override:true})). La mas grave era preexistente:
// test/mensaje-asesor.test.js hacia un PATCH real a /rest/v1/messages contra
// la base de un negocio en operacion, y otros cuatro tests (aprobar/rechazar/
// registrar-resultado-radar, command-radar-resultado-y-envio) hacian GET
// reales a signal_events. Tapar cada caso por separado ya se demostro
// insuficiente — ver src/data/supabase.js y src/lib/waha.js, donde la defensa
// quedo puesta en la raiz.
//
// Este archivo no prueba el sintoma (que un test puntual no llame a la red):
// prueba que la defensa de la raiz siga en pie. Si alguien borra el guard de
// cualquiera de los dos modulos, estas pruebas se caen.
//
// La comprobacion real de que ningun request sale a la red durante `npm test`
// se hizo aparte, a mano: un servidor HTTP local que loguea cualquier peticion,
// apuntando SUPABASE_URL/SUPABASE_SERVICE_KEY/WAHA_URL/WAHA_API_KEY (con
// credenciales falsas pero de forma valida) a ese servidor mientras corria la
// suite completa. El log quedo vacio. Ver el reporte en
// .superpowers/sdd/fix-important-report.md.

const { test } = require("node:test");
const assert = require("node:assert");

test("src/data/supabase.js nunca crea el cliente real bajo test, aunque config traiga credenciales", () => {
  assert.ok(
    process.env.NODE_TEST_CONTEXT,
    "esta prueba asume que corre bajo `node --test` (NODE_TEST_CONTEXT lo pone el runner)"
  );

  // Config se reemplaza por un doble con credenciales FALSAS pero de forma
  // valida, para que el resultado no dependa de si esta maquina tiene un .env
  // real configurado: el guard tiene que ganarle a
  // config.supabaseUrl/supabaseServiceKey SIEMPRE que estemos bajo test, no
  // solo cuando el .env local esta vacio.
  const configPath = require.resolve("../src/config");
  const supabasePath = require.resolve("../src/data/supabase");
  delete require.cache[configPath];
  delete require.cache[supabasePath];
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: { supabaseUrl: "https://fake-org.supabase.co", supabaseServiceKey: "fake-service-key" },
  };

  try {
    const client = require(supabasePath);
    assert.strictEqual(
      client,
      null,
      "el guard de src/data/supabase.js debe devolver null bajo NODE_TEST_CONTEXT " +
        "aunque config traiga credenciales validas (ver el comentario de ese archivo, 2026-08-24)"
    );
  } finally {
    delete require.cache[supabasePath];
    delete require.cache[configPath];
  }
});

test("src/lib/waha.js corta antes de la red real si nadie mockeo fetch bajo test", async () => {
  assert.ok(
    process.env.NODE_TEST_CONTEXT,
    "esta prueba asume que corre bajo `node --test` (NODE_TEST_CONTEXT lo pone el runner)"
  );

  const wahaPath = require.resolve("../src/lib/waha");
  delete require.cache[wahaPath];
  const envPrevio = { WAHA_URL: process.env.WAHA_URL, WAHA_API_KEY: process.env.WAHA_API_KEY };
  // Host que nunca deberia poder resolverse. Si el guard desaparece, esto deja
  // de fallar con el mensaje esperado y falla (o se cuelga) por un intento real
  // de red — que es justo la señal de que la defensa se perdio.
  process.env.WAHA_URL = "http://esto-no-deberia-resolverse.invalid";
  process.env.WAHA_API_KEY = "clave-de-prueba-del-guard";

  try {
    const waha = require(wahaPath);
    const r = await waha.enviarTexto("sesion-guard-test", "123@g.us", "hola");
    assert.strictEqual(r.ok, false);
    assert.match(
      r.error,
      /fetch no fue mockeado/,
      "si este mensaje de error cambia sin que sea a proposito, revisa si el guard de src/lib/waha.js sigue en pie"
    );
  } finally {
    if (envPrevio.WAHA_URL === undefined) delete process.env.WAHA_URL;
    else process.env.WAHA_URL = envPrevio.WAHA_URL;
    if (envPrevio.WAHA_API_KEY === undefined) delete process.env.WAHA_API_KEY;
    else process.env.WAHA_API_KEY = envPrevio.WAHA_API_KEY;
    delete require.cache[wahaPath];
  }
});
