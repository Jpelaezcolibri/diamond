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
