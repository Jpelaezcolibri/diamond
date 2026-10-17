// Caso real 2026-10-17, 6:41 a. m. (Catherine Uribe, Asesor 3): "Muéstrame
// qué opciones tienes" -> Sofi escribio "Déjame buscarte todo lo que tenemos
// amoblado..." EN EL MISMO TURNO que llamo a buscar_propiedades. La busqueda
// volvio vacia (el inventario estaba caido), el modelo no dio respuesta final
// y el motor mando solo la promesa: como ya habia texto, no reintentaba.
// Catherine espero 4 horas y termino escribiendole a la linea del radar.

const { test } = require("node:test");
const assert = require("node:assert");
const { _setClientForTests } = require("../src/lib/anthropic");
const engine = require("../src/agent/engine");

const ORG = { id: "org-test-promesa", name: "Diamond", slug: "diamond" };
const promesa = "Déjame buscarte todo lo que tenemos amoblado para arriendo";

function cliente(respuestas) {
  const llamadas = [];
  _setClientForTests({
    messages: {
      create: async (params) => {
        llamadas.push(params);
        return respuestas[Math.min(llamadas.length - 1, respuestas.length - 1)];
      },
    },
  });
  return llamadas;
}

const conTool = {
  stop_reason: "tool_use",
  content: [{ type: "text", text: promesa }, { type: "tool_use", id: "t1", name: "buscar_propiedades", input: { zona: "El Poblado", operacion: "arriendo" } }],
  usage: {},
};
const vacia = { stop_reason: "end_turn", content: [], usage: {} };

test("si despues de la herramienta no llega respuesta final, se pide de nuevo", async (t) => {
  t.after(() => _setClientForTests(null));
  const llamadas = cliente([conTool, vacia, { stop_reason: "end_turn", content: [{ type: "text", text: "Ahora mismo no tengo amoblados en esa zona." }], usage: {} }]);
  const { reply } = await engine.procesarMensaje({ org: ORG, phone: "573000000101", text: "Muéstrame qué opciones tienes" });
  assert.match(reply, /no tengo amoblados/);
  assert.strictEqual(llamadas.length, 3);
});

test("si tampoco llega en el reintento, nunca queda solo la promesa", async (t) => {
  t.after(() => _setClientForTests(null));
  cliente([conTool, vacia, vacia]);
  const { reply } = await engine.procesarMensaje({ org: ORG, phone: "573000000102", text: "Muéstrame qué opciones tienes" });
  assert.notStrictEqual(reply.trim(), promesa);
  assert.ok(reply.length > promesa.length, "tiene que cerrar la promesa con algo");
});
