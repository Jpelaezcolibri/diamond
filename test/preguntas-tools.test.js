// Tools de preguntas al asesor (spec 2026-10-25 §5.1 y §5.4).
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const { executeTool, toolsActivas } = require("../src/agent/tools");

const A1 = { id: "a1", org_id: "org-1", name: "Daiana Zea", phone: "573011880668", activo: true, recibe_citas: true, orden_citas: 1 };
beforeEach(() => {
  memory.preguntasAsesor.length = 0;
  memory.advisors.length = 0;
  memory.advisors.push({ ...A1 });
  memory.leads.length = 0;
  memory.leads.push({ id: "l1", org_id: "org-1", phone: "573125550000", nombre: "Andrea", source: "colega" });
});
afterEach(() => { delete process.env.SOFI_PREGUNTA_ASESOR; });

const nombres = () => toolsActivas().map((t) => t.name);

test("apagado: las tools no existen para el modelo", () => {
  assert.ok(!nombres().includes("preguntar_al_asesor"));
  assert.ok(!nombres().includes("responder_pregunta"));
});

test("encendido: aparecen las dos", () => {
  process.env.SOFI_PREGUNTA_ASESOR = "true";
  assert.ok(nombres().includes("preguntar_al_asesor"));
  assert.ok(nombres().includes("responder_pregunta"));
});

test("apagado: executeTool no registra nada aunque el modelo la llame", async () => {
  const out = await executeTool("preguntar_al_asesor", { pregunta: "¿precio final?", ref: "1", tipo: "precio" }, { org: { id: "org-1" }, lead: memory.leads[0] });
  assert.match(out, /apagada/);
  assert.strictEqual(memory.preguntasAsesor.length, 0);
});

test("un asesor no puede usar preguntar_al_asesor, y un colega no puede responder", async () => {
  process.env.SOFI_PREGUNTA_ASESOR = "true";
  const a = await executeTool("preguntar_al_asesor", { pregunta: "¿x?", tipo: "otro" }, { org: { id: "org-1" }, lead: memory.leads[0], advisor: A1 });
  assert.match(a, /para colegas y clientes/);
  const b = await executeTool("responder_pregunta", { pregunta_id: "x", respuesta: "y" }, { org: { id: "org-1" }, lead: memory.leads[0] });
  assert.match(b, /solo para un asesor/);
});

test("responder_pregunta usa la pregunta citada si no viene id", async () => {
  process.env.SOFI_PREGUNTA_ASESOR = "true";
  memory.preguntasAsesor.push({ id: "p1", org_id: "org-1", lead_id: "l1", ref: "1", tipo: "precio", pregunta: "¿precio?", estado: "pendiente", asesor_id: "a1" });
  const out = await executeTool("responder_pregunta", { respuesta: "450 final" }, { org: { id: "org-1" }, lead: { id: "la" }, advisor: A1, preguntaId: "p1" });
  assert.match(out, /Listo|guardada|avisé/);
  assert.strictEqual(memory.preguntasAsesor[0].respuesta, "450 final");
});

test("responder_pregunta con la citada cerrada: no usa otra pendiente ni guarda nada", async () => {
  process.env.SOFI_PREGUNTA_ASESOR = "true";
  memory.preguntasAsesor.push({ id: "p1", org_id: "org-1", lead_id: "l1", ref: "1", tipo: "precio", pregunta: "¿precio?", estado: "pendiente", asesor_id: "a1" });
  const cerrada = { id: "p9", estado: "respondida", respondida_por: "Claudia" };
  for (const input of [{ respuesta: "320 millones" }, { pregunta_id: "p1", respuesta: "320 millones" }]) {
    const out = await executeTool("responder_pregunta", input, { org: { id: "org-1" }, lead: { id: "la" }, advisor: A1, preguntaId: null, preguntaCerrada: cerrada });
    assert.match(out, /ya está cerrada/);
  }
  assert.strictEqual(memory.preguntasAsesor[0].estado, "pendiente");
  assert.strictEqual(memory.preguntasAsesor[0].respuesta, undefined);
});
