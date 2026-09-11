const { test } = require("node:test");
const assert = require("node:assert");

const { buildSystemPrompt } = require("../src/agent/prompts");

const ORG = { id: "org-1", name: "Diamond Inmobiliaria" };
const ADVISOR = { name: "Natalia Perez" };

test("promptAsesor menciona confirmar_cita y OK CONFIRMADA", () => {
  const bloques = buildSystemPrompt({ org: ORG, advisor: ADVISOR, now: null });
  const texto = bloques.map((b) => b.text).join("\n");
  assert.match(texto, /confirmar_cita/);
  assert.match(texto, /OK CONFIRMADA/);
});
