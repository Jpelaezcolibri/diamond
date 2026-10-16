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

test("el flujo del dueno esta acotado y no se cuela al prompt del colega", () => {
  const t = textoDelPrompt();
  assert.match(t, /NUNCA le ofrezcas inventario/);
  assert.match(t, /reglas de inventario.*NO aplican/i);
  assert.match(t, /zona y barrio, tipo de inmueble, alcobas, cuanto espera recibir, si esta amoblado, si es arriendo mensual o por noches, y su nombre/);
  assert.match(t, /nunca 31-33 ni 33a-33d/);
  const colega = prompts.buildSystemPrompt({
    org: { id: "org-1", name: "Diamond" },
    lead: { id: "l1", estado: "nuevo" },
    qualified: false,
    now: null,
    colega: { nombre: "Esteban Higuita" },
    coordinador: { nombre: "Daiana Zea", telefono: "573011880668" },
  }).map((b) => b.text).join("\n");
  assert.doesNotMatch(colega, /DUENO QUE QUIERE ARRENDAR/);
});
