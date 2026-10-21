const test = require("node:test");
const assert = require("node:assert/strict");
const redactar = require("../src/groups/redactar");
const { buildSystemPrompt } = require("../src/agent/prompts");

const PROP = { ref: "1", linkWasi: "https://x/1", operacion: "Venta", zona: "Envigado", titulo: "Apto" };
const ORG = { name: "Diamond" };
function conEnv(valor, fn) {
  const antes = process.env.RADAR_LINEA_COMISION;
  if (valor === undefined) delete process.env.RADAR_LINEA_COMISION; else process.env.RADAR_LINEA_COMISION = valor;
  try { return fn(); } finally { if (antes === undefined) delete process.env.RADAR_LINEA_COMISION; else process.env.RADAR_LINEA_COMISION = antes; }
}
function promptColega() {
  const r = buildSystemPrompt({ org: ORG, lead: {}, qualified: false, now: null, colega: { nombre: "Ana" } });
  return (Array.isArray(r) ? r.map((b) => b.text).join("\n") : r);
}

test("lineaComision: sin variable, el texto de siempre", () => {
  conEnv(undefined, () => assert.equal(redactar.lineaComision(ORG), "Comisión compartida."));
  conEnv("  ", () => assert.equal(redactar.lineaComision(ORG), "Comisión compartida."));
});
test("lineaComision y cierre del DM con variable", () => {
  conEnv("Comisión compartida 50/50.", () => {
    assert.equal(redactar.lineaComision(ORG), "Comisión compartida 50/50.");
    assert.ok(redactar.lineasCierre(ORG).join("\n").includes("Comisión compartida 50/50."));
  });
});
test("post de grupo: con variable la usa, sin ella el texto de siempre", () => {
  conEnv("Comisión compartida 50/50.", () => {
    const t = redactar.postGrupo(PROP, { org: ORG });
    assert.match(t, /🤝 Comisión compartida 50\/50\./);
    assert.doesNotMatch(t, /Comparto comisión/);
  });
  conEnv(undefined, () => assert.match(redactar.postGrupo(PROP, { org: ORG }), /Comparto comisión con colegas 🤝/));
});
test("prompt de colega: con variable trae el texto exacto, sin ella la regla de hoy", () => {
  conEnv("Comisión compartida 50/50.", () => assert.match(promptColega(), /Comisión compartida 50\/50\./));
  conEnv(undefined, () => {
    const p = promptColega();
    assert.match(p, /COMISION: si el pone el cliente/);
    assert.doesNotMatch(p, /50\/50/);
  });
});
