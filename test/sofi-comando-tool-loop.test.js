// Bug real 2026-08-18: Juan le pidio a Sofi-Comando mandar un WhatsApp por
// cada uno de 6 pedidos pendientes. El loop de tool-use se quedo sin
// iteraciones a mitad de camino, y como el ultimo turno era puro tool_use
// (sin texto), el reply caia en el fallback generico "No pude procesar eso"
// — sin decir que ya habia hecho varias acciones ni que quedaba trabajo.

const { test } = require("node:test");
const assert = require("node:assert");
const { _setClientForTests } = require("../src/lib/anthropic");
const sofiComando = require("../src/agent/sofi-comando");
const command = require("../src/data/command");

const SCOPE = Object.freeze({ orgId: "org-1", viewerUid: "admin-1", role: "admin", isAdmin: true });

// El modelo SIEMPRE pide una tool y nunca suelta texto — simula una tarea
// que necesita mas pasos de los que caben en un turno.
function clienteQueNuncaTermina() {
  const llamadas = [];
  _setClientForTests({
    messages: {
      create: async (params) => {
        llamadas.push(params);
        return {
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: `call-${llamadas.length}`, name: "consultar_recordatorios", input: {} }],
        };
      },
    },
  });
  return llamadas;
}

function mockSesion(t) {
  t.mock.method(command, "getSession", async () => ({ id: "sess-1", org_id: "org-1", user_id: "admin-1" }));
  t.mock.method(command, "getRecentCommandMessages", async () => []);
  const guardados = [];
  t.mock.method(command, "appendCommandMessage", async (sessionId, role, content) => {
    guardados.push({ sessionId, role, content });
    return { id: `m-${guardados.length}` };
  });
  t.mock.method(command, "recordatoriosPendientes", async () => []);
  return guardados;
}

test("el loop no se cuelga infinito: para en un tope finito de iteraciones", async (t) => {
  const llamadas = clienteQueNuncaTermina();
  mockSesion(t);

  await sofiComando.processMessage(SCOPE, "sess-1", "mandale un mensaje a cada uno de los 6 pendientes", {});

  // No es un numero magico especifico: lo que importa es que TERMINA. Un
  // bug de loop infinito no habria dejado terminar este test.
  assert.ok(llamadas.length > 1 && llamadas.length < 50, `se esperaba un numero acotado de llamadas, dio ${llamadas.length}`);
  t.after(() => _setClientForTests(null));
});

test("si se agotan las iteraciones sin texto, el reply es honesto — no el fallback generico", async (t) => {
  clienteQueNuncaTermina();
  const guardados = mockSesion(t);

  const { reply } = await sofiComando.processMessage(SCOPE, "sess-1", "mandale un mensaje a cada uno de los 6 pendientes", {});

  assert.doesNotMatch(reply, /^No pude procesar eso/, "el bug real: no decia que ya habia hecho cosas");
  assert.match(reply, /segui/i, "tiene que invitar a continuar, no sonar a callejon sin salida");
  assert.strictEqual(guardados[guardados.length - 1].content, reply, "lo que se persiste es lo mismo que se devuelve");
  t.after(() => _setClientForTests(null));
});

test("con una respuesta normal (con texto), el reply de siempre sigue intacto", async (t) => {
  const llamadas = [];
  _setClientForTests({
    messages: {
      create: async (params) => {
        llamadas.push(params);
        return { stop_reason: "end_turn", content: [{ type: "text", text: "Todo tranquilo por hoy." }] };
      },
    },
  });
  mockSesion(t);

  const { reply } = await sofiComando.processMessage(SCOPE, "sess-1", "como va todo", {});

  assert.strictEqual(reply, "Todo tranquilo por hoy.");
  assert.strictEqual(llamadas.length, 1, "sin tool_use, no debe entrar al loop");
  t.after(() => _setClientForTests(null));
});

const { _setClientForTests: _setClient } = require("../src/lib/anthropic");
const canalWhatsapp = require("../src/channels/whatsapp");
const organizations = require("../src/data/organizations");
const advisors = require("../src/data/advisors");
const mandatos = require("../src/data/mandatos");

// NOTA (verificado empiricamente en Step 2, 2026-09-01): mockear
// executeCommandTool con t.mock.method(require("../src/agent/sofi-comando-tools"), ...)
// NO intercepta la llamada real que hace sofi-comando.js. Ese modulo hace
// `const { executeCommandTool } = require("./sofi-comando-tools");` — una
// desestructuracion que copia la referencia a la funcion UNA sola vez, al
// cargar el modulo (antes de que cualquier test corra). Reemplazar la
// propiedad en el objeto exportado despues no cambia esa referencia ya
// capturada. Confirmado con un log temporal: con el mock "instalado", el
// loop seguia ejecutando el executeCommandTool real (registrar_mandato_compra
// terminaba en "Esta herramienta es interna del equipo...", no en el texto
// mockeado). La alternativa que SI funciona (mismo patron que ya usa
// mockSesion con `command.*`): mockear los metodos de los modulos de datos
// que se llaman por ACCESO A PROPIEDAD en tiempo de invocacion
// (`command.crearRecordatorio(...)`, `advisors.findByAuthUserId(...)`,
// `mandatos.crear(...)`) — esos SI resuelven la propiedad actual en cada
// llamada, asi que un t.mock.method sobre el modulo si los reemplaza.

test("si Sofi confirma una accion sin haber llamado ninguna herramienta, se agrega el disclaimer y se notifica", async (t) => {
  _setClient({
    messages: {
      create: async () => ({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Guardado ✅ MANDATO DE COMPRA #1 — Cliente de Daiana Zea" }],
      }),
    },
  });
  mockSesion(t);
  process.env.RADAR_WATCHDOG_TO = "573001112233";
  t.mock.method(organizations, "findById", async () => ({ id: "org-1", name: "Diamond" }));
  const notificados = [];
  t.mock.method(canalWhatsapp, "sendWhatsApp", async (org, to, texto) => {
    notificados.push({ to, texto });
    return { ok: true };
  });

  const { reply } = await sofiComando.processMessage(SCOPE, "sess-1", "guardalo como mandato", {});

  assert.match(reply, /Guardado ✅ MANDATO DE COMPRA #1/, "no se oculta lo que Sofi intento decir");
  assert.match(reply, /No pude confirmar que esto se haya ejecutado/i);
  assert.strictEqual(notificados.length, 1);
  assert.match(notificados[0].texto, /posible acci[oó]n no confirmada/i);

  t.after(() => { _setClient(null); delete process.env.RADAR_WATCHDOG_TO; });
});

test("si Sofi llama una herramienta mutante de verdad, NO se agrega disclaimer ni se notifica", async (t) => {
  let llamada = 0;
  _setClient({
    messages: {
      create: async () => {
        llamada++;
        if (llamada === 1) {
          return {
            stop_reason: "tool_use",
            content: [{ type: "tool_use", id: "call-1", name: "crear_recordatorio", input: { descripcion: "llamar a Sara A" } }],
          };
        }
        return { stop_reason: "end_turn", content: [{ type: "text", text: "Listo, te dejé el recordatorio de llamar a Sara A." }] };
      },
    },
  });
  mockSesion(t);
  // La herramienta real (crear_recordatorio -> command.crearRecordatorio)
  // corre de verdad; se mockea solo el data-layer para controlar el resultado
  // sin depender del fallback en memoria de src/data/command.js.
  t.mock.method(command, "crearRecordatorio", async () => ({ id: "rem-1", descripcion: "llamar a Sara A", fecha_hora: null }));
  process.env.RADAR_WATCHDOG_TO = "573001112233";
  const notificados = [];
  t.mock.method(canalWhatsapp, "sendWhatsApp", async (org, to, texto) => { notificados.push(texto); return { ok: true }; });

  const { reply } = await sofiComando.processMessage(SCOPE, "sess-1", "recordame llamar a Sara A", {});

  assert.doesNotMatch(reply, /No pude confirmar/i);
  assert.strictEqual(notificados.length, 0);

  t.after(() => { _setClient(null); delete process.env.RADAR_WATCHDOG_TO; });
});

test("si una herramienta mutante devuelve un fallo real, se notifica aunque el texto de Sofi sea honesto", async (t) => {
  let llamada = 0;
  _setClient({
    messages: {
      create: async () => {
        llamada++;
        if (llamada === 1) {
          return {
            stop_reason: "tool_use",
            content: [{ type: "tool_use", id: "call-1", name: "registrar_mandato_compra", input: { cliente_nombre: "Sara A", operacion: "Venta" } }],
          };
        }
        return { stop_reason: "end_turn", content: [{ type: "text", text: "No pude guardar el mandato, avisale a Juan por si falta una migración." }] };
      },
    },
  });
  mockSesion(t);
  // Igual que arriba: la herramienta real corre de verdad. Se mockea el
  // data-layer que registrar_mandato_compra toca (src/agent/tools.js) para
  // forzar el mismo fallo real que produciria una migracion faltante:
  // advisor SI existe (pasa la primera compuerta) pero mandatos.crear revienta.
  t.mock.method(advisors, "findByAuthUserId", async () => ({ id: "adv-1", org_id: "org-1", name: "Daiana Zea" }));
  t.mock.method(mandatos, "crear", async () => { throw new Error("falta correr una migracion"); });
  process.env.RADAR_WATCHDOG_TO = "573001112233";
  t.mock.method(organizations, "findById", async () => ({ id: "org-1", name: "Diamond" }));
  const notificados = [];
  t.mock.method(canalWhatsapp, "sendWhatsApp", async (org, to, texto) => { notificados.push(texto); return { ok: true }; });

  const { reply } = await sofiComando.processMessage(SCOPE, "sess-1", "guardalo como mandato", {});

  assert.doesNotMatch(reply, /No pude confirmar que esto se haya ejecutado/i, "el texto ya es honesto, no hace falta el disclaimer");
  assert.strictEqual(notificados.length, 1);
  assert.match(notificados[0], /fallo real de herramienta/i);

  t.after(() => { _setClient(null); delete process.env.RADAR_WATCHDOG_TO; });
});
