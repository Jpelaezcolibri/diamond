// Sofi recuerda al colega (Juan, 2026-10-07): sus ultimos pedidos, lo que se
// le mando y sus citas, aunque el DM haya salido por la linea del radar.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const groupSignals = require("../src/data/group-signals");
const { buildSystemPrompt } = require("../src/agent/prompts");

beforeEach(() => {
  memory.groupSignals.length = 0;
});

test("historialColega trae los pedidos respondidos del colega por lid (con o sin sufijo) y por teléfono", async () => {
  memory.groupSignals.push(
    { id: "s1", org_id: "org-1", clase: "demanda", created_at: "2026-09-10T15:00:00Z", respondida_at: "2026-09-10T15:05:00Z", respuesta_destino_lid: "111222333444555@lid", tipo: "apartamento", operacion: "venta", zona: "Laureles", respuesta_refs: ["9921137"] },
    { id: "s2", org_id: "org-1", clase: "demanda", created_at: "2026-09-20T15:00:00Z", respondida_at: "2026-09-20T15:05:00Z", respuesta_destino_lid: "111222333444555", tipo: "casa", operacion: "venta", zona: "Envigado", respuesta_refs: ["10077063"] },
    { id: "s3", org_id: "org-1", clase: "demanda", created_at: "2026-09-21T15:00:00Z", respondida_at: "2026-09-21T15:05:00Z", respuesta_destino_telefono: "573125550000", respuesta_refs: ["10012722"] },
    { id: "s4", org_id: "org-1", clase: "demanda", created_at: "2026-09-22T15:00:00Z", respondida_at: "2026-09-22T15:05:00Z", respuesta_destino_lid: "999@lid", respuesta_refs: ["1"] },
    { id: "s5", org_id: "org-1", clase: "demanda", created_at: "2026-09-23T15:00:00Z", respondida_at: null, respuesta_destino_lid: "111222333444555@lid" },
  );
  const h = await groupSignals.historialColega("org-1", { lid: "111222333444555", telefono: "573125550000" });
  assert.deepStrictEqual(h.map((s) => s.id), ["s3", "s2", "s1"], "más reciente primero, solo los respondidos y del colega");
});

test("el prompt con historial trae LO QUE YA HABLAMOS con las refs", () => {
  const bloques = buildSystemPrompt({
    org: { id: "org-1", name: "Diamond" },
    lead: { id: "l1", estado: "nuevo", cita: { estado: "propuesta", fecha_hora: "2026-10-09T20:00:00Z", ref: "10012722" } },
    qualified: false,
    now: null,
    colega: { nombre: "Laura" },
    historial: [
      { created_at: "2026-09-20T15:00:00Z", tipo: "casa", operacion: "venta", zona: "Envigado", respuesta_refs: ["10077063", "10031500"] },
    ],
  });
  const volatil = bloques[bloques.length - 1].text;
  assert.match(volatil, /LO QUE YA HABLAMOS/);
  assert.match(volatil, /casa venta en Envigado — le mandamos refs 10077063, 10031500/);
  assert.match(volatil, /Cita: propuesta .*ref 10012722/);
});

test("sin historial no aparece el bloque", () => {
  const bloques = buildSystemPrompt({
    org: { id: "org-1", name: "Diamond" }, lead: { id: "l1", estado: "nuevo" }, qualified: false, now: null, colega: { nombre: "Laura" },
  });
  assert.doesNotMatch(bloques[bloques.length - 1].text, /LO QUE YA HABLAMOS/);
});
