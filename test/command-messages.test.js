const { test } = require("node:test");
const assert = require("node:assert");
const { toApiMessages } = require("../src/agent/sofi-comando");

// La API de Anthropic exige que los mensajes empiecen en "user" y alternen. El
// historial del comando siempre empieza con el briefing (assistant), asi que sin
// normalizar, el PRIMER mensaje del asesor daria 400 y rompería todo el chat.

test("toApiMessages: descarta el briefing (assistant) inicial y empieza en user", () => {
  const history = [
    { role: "assistant", content: "briefing" },
    { role: "user", content: "hola" },
  ];
  const out = toApiMessages(history);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].role, "user");
  assert.strictEqual(out[0].content, "hola");
});

test("toApiMessages: fusiona assistants consecutivos (respuesta + resumen de cierre)", () => {
  const history = [
    { role: "assistant", content: "briefing" },
    { role: "user", content: "m1" },
    { role: "assistant", content: "r1" },
    { role: "assistant", content: "resumen cierre" },
    { role: "user", content: "m2" },
  ];
  const out = toApiMessages(history);

  // Empieza en user y alterna estrictamente.
  assert.strictEqual(out[0].role, "user");
  for (let i = 1; i < out.length; i++) {
    assert.notStrictEqual(out[i].role, out[i - 1].role, "los roles deben alternar");
  }
  // El assistant fusionado conserva ambos contenidos.
  const merged = out.find((m) => m.role === "assistant");
  assert.match(merged.content, /r1/);
  assert.match(merged.content, /resumen cierre/);
});

test("toApiMessages: ventana recortada que empieza en assistant tambien queda valida", () => {
  // getRecentCommandMessages puede devolver una ventana que arranca en assistant.
  const history = [
    { role: "assistant", content: "r-previa" },
    { role: "user", content: "u1" },
    { role: "assistant", content: "a1" },
  ];
  const out = toApiMessages(history);
  assert.strictEqual(out[0].role, "user");
  for (let i = 1; i < out.length; i++) {
    assert.notStrictEqual(out[i].role, out[i - 1].role);
  }
});
