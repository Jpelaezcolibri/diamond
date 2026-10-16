const { test } = require("node:test");
const assert = require("node:assert");
const { refDeKit } = require("../src/agent/kit-origen");

test("lee la ref del texto prellenado del kit", () => {
  assert.strictEqual(refDeKit("Hola, vi en un grupo la Ref 10077063"), "10077063");
  assert.strictEqual(refDeKit("hola vi en un grupo la ref AP004 me interesa"), "AP004");
});

test("no confunde otros mensajes con una ref", () => {
  assert.strictEqual(refDeKit("me interesa la ref 10077063"), null);
  assert.strictEqual(refDeKit("vi en un grupo un apartamento"), null);
  assert.strictEqual(refDeKit(""), null);
  assert.strictEqual(refDeKit(null), null);
});
