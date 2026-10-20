// Parametros por modelo (src/lib/anthropic.js#paramsDeModelo), 2026-10-20:
// Sofi pasa a Sonnet 5.5 y Sonnet 4.x tiene que seguir funcionando si se
// vuelve por CLAUDE_MODEL.
const { test } = require("node:test");
const assert = require("node:assert");
const { paramsDeModelo } = require("../src/lib/anthropic");

test("Sonnet 5.5: effort low y tope de al menos 4.096 (el thinking cuenta en max_tokens)", () => {
  assert.deepStrictEqual(paramsDeModelo("claude-sonnet-5-5", { maxTokens: 2048 }), {
    model: "claude-sonnet-5-5", max_tokens: 4096, output_config: { effort: "low" },
  });
});

test("Sonnet 5.5 sin thinking: between_tools y el tope pedido", () => {
  assert.deepStrictEqual(paramsDeModelo("claude-sonnet-5-5", { maxTokens: 300, sinThinking: true }), {
    model: "claude-sonnet-5-5", max_tokens: 300, thinking: { type: "between_tools" }, output_config: { effort: "low" },
  });
});

test("Sonnet 5.5 conserva el formato de salida que pide quien llama", () => {
  const p = paramsDeModelo("claude-sonnet-5-5", { maxTokens: 1000, outputConfig: { format: { type: "json_schema", schema: {} } } });
  assert.deepStrictEqual(p.output_config, { format: { type: "json_schema", schema: {} }, effort: "low" });
});

test("Sonnet 4.5 va igual que antes: sin effort ni thinking", () => {
  assert.deepStrictEqual(paramsDeModelo("claude-sonnet-4-5", { maxTokens: 2048 }), { model: "claude-sonnet-4-5", max_tokens: 2048 });
  assert.deepStrictEqual(paramsDeModelo("claude-sonnet-4-5", { maxTokens: 1000, outputConfig: { format: { type: "json_schema", schema: {} } } }), {
    model: "claude-sonnet-4-5", max_tokens: 1000, output_config: { format: { type: "json_schema", schema: {} } },
  });
});
