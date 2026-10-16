const { test } = require("node:test");
const assert = require("node:assert");
const prompts = require("../src/agent/prompts");

function textoDelPrompt() {
  const p = prompts.buildSystemPrompt({ org: { id: "org-1", name: "Diamond" }, lead: { id: "l1", estado: "nuevo" }, qualified: false, now: null });
  return Array.isArray(p) ? p.map((b) => b.text || "").join("\n") : String(p);
}

test("el prompt tiene el flujo del dueno que quiere arrendar", () => {
  const t = textoDelPrompt();
  assert.match(t, /DUENO QUE QUIERE ARRENDAR/);
  assert.match(t, /consignar_arriendo/);
  assert.match(t, /registrar_inmueble_ofrecido/);
  assert.match(t, /RNT/);
});
