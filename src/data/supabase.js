const config = require("../config");

// Guarda de red 2026-08-24 (revision final de fase1-directorio-colegas, Juan).
//
// Motivo concreto: en esta sola rama, CUATRO corridas de test salieron a la
// Supabase o WAHA reales porque el .env local del dev trae credenciales de
// produccion (config.js las carga con dotenv({override:true})). Se tapo cada
// caso por separado (ver los mocks de require.cache en test/colegas-data.test.js
// y test/directorio.test.js) y no alcanzo: la mas grave fue preexistente y sin
// relacion con esta rama — test/mensaje-asesor.test.js hacia un PATCH real a
// /rest/v1/messages contra la base de un negocio en operacion, y otros cuatro
// tests (aprobar/rechazar/registrar-resultado-radar,
// command-radar-resultado-y-envio) hacian GET reales a signal_events.
//
// La defensa tiene que estar en la raiz, donde se crea el cliente, no en cada
// test nuevo que alguien recuerde escribir con cuidado.
//
// process.env.NODE_TEST_CONTEXT lo pone el runner de `node --test` en cada
// worker (verificado en este repo con Node 20.13.1: vale "child-v8"). Con el
// cliente ausente, los modulos de datos caen solos a su rama de memoria — que
// es justo el modo que los tests quieren — sin que cada test tenga que acordarse
// de mockear nada.
//
// Ojo si tocas esto: algunos tests (test/linea-dm.test.js,
// test/radar-trazabilidad.test.js, test/signal-events.test.js,
// test/visitas.test.js) SI necesitan un cliente truthy para poder mockear su
// metodo from() por tabla — para eso inyectan su propio doble en
// require.cache ANTES de requerir este modulo, en vez de depender de que este
// guard se desactive.
const bajoTest = Boolean(process.env.NODE_TEST_CONTEXT);

let client = null;

if (!bajoTest && config.supabaseUrl && config.supabaseServiceKey) {
  const { createClient } = require("@supabase/supabase-js");
  // Node 20 no trae WebSocket nativo (lo exige realtime-js); ws lo suple
  const { WebSocket } = require("ws");
  client = createClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth: { persistSession: false },
    realtime: { transport: WebSocket },
  });
}

module.exports = client;
