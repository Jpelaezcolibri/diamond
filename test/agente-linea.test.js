// Agentes automaticos en la linea del radar (Juan, 2026-10-28: "identifica
// siempre si es un agente para que no tengamos confusiones"). Caso elizabeth
// muriel: el asistente de otra inmobiliaria le contesto a Sofi y su "quedamos
// atentos para coordinar la visita" quedo como cita.
const { test } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const colegas = require("../src/data/colegas");
const agenteLinea = require("../src/groups/agente-linea");

const ORG = { id: "org-ag" };
const LID = "243344424886478@lid";
const BOT = [
  "He conectado tu mensaje con nuestro equipo para que lo revisen.",
  "¡Hola! Te recomiendo que accedas a nuestro catálogo aquí en WhatsApp para ver opciones.",
];

function limpiar() {
  memory.colegasGrupos.length = 0;
}

test("colegas: marcarAgente deja la marca permanente y esAgente la lee por lid", async () => {
  limpiar();
  assert.strictEqual(await colegas.esAgente(ORG.id, { lid: LID }), false);
  const r = await colegas.marcarAgente(ORG.id, { lid: LID, nombre: "elizabeth muriel", motivo: "frases automaticas" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(await colegas.esAgente(ORG.id, { lid: LID }), true);
  const fila = memory.colegasGrupos.find((c) => c.lid === "243344424886478");
  assert.strictEqual(fila.es_agente_motivo, "frases automaticas");
  assert.ok(fila.es_agente_at);
  limpiar();
});

test("detectar: dos mensajes automaticos en el hilo lo marcan para siempre", async () => {
  limpiar();
  const r = await agenteLinea.detectar(ORG, { identidad: { lid: LID }, nombre: "elizabeth muriel", textos: [...BOT, "Perfecto Diamond, quedamos atentos"] });
  assert.strictEqual(r.agente, true);
  assert.strictEqual(r.marcado, true);
  // El siguiente mensaje, aunque suene humano, ya sale como agente.
  const r2 = await agenteLinea.detectar(ORG, { identidad: { lid: LID }, textos: ["el cliente puede el lunes a las 4"] });
  assert.strictEqual(r2.agente, true);
  assert.strictEqual(r2.motivo, "marcado");
  limpiar();
});

test("detectar: un solo mensaje automatico frena este hilo pero no marca (una persona puede escribir 'gracias por tu mensaje')", async () => {
  limpiar();
  const r = await agenteLinea.detectar(ORG, { identidad: { lid: LID }, textos: ["Gracias por tu mensaje, ya lo reviso con mi cliente"] });
  assert.strictEqual(r.agente, true);
  assert.strictEqual(r.marcado, false);
  assert.strictEqual(await colegas.esAgente(ORG.id, { lid: LID }), false);
  limpiar();
});

test("detectar: un colega normal no es agente", async () => {
  limpiar();
  const r = await agenteLinea.detectar(ORG, { identidad: { lid: LID }, textos: ["¿en qué sector queda?", "el cliente puede el lunes a las 4"] });
  assert.strictEqual(r.agente, false);
  limpiar();
});

test("detectar: si no se puede leer la marca, sigue con las frases (falla abierto: no frena a un colega real)", async (t) => {
  limpiar();
  t.mock.method(colegas, "esAgente", async () => null);
  const r = await agenteLinea.detectar(ORG, { identidad: { lid: LID }, textos: ["¿en qué sector queda?"] });
  assert.strictEqual(r.agente, false);
});

test("el clasificador de la linea pregunta si es un agente", () => {
  const dm = require("../src/groups/dm");
  assert.ok(dm.ESQUEMA.required.includes("es_agente"));
  assert.strictEqual(dm.ESQUEMA.properties.es_agente.type, "boolean");
});
