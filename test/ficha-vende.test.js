const { test } = require("node:test");
const assert = require("node:assert");
const { executeTool } = require("../src/agent/tools");
const properties = require("../src/data/properties");
const propertyContext = require("../src/data/property-context");
const { buildSystemPrompt } = require("../src/agent/prompts");

const ctx = () => ({
  org: { id: "org-1", name: "Diamond" },
  lead: { id: "lead-1", phone: "573001112233", categoria: "compra", estado: "en_conversacion", score: 0 },
  propertyInteres: null, transfer: null, cita: null, allyMatch: null, allyAlert: null, lastUserMessage: "",
});

async function buscar(t, fila) {
  t.mock.method(properties, "search", async () => [{ id: "p1", ref: "1", disponible: true, ...fila }]);
  t.mock.method(propertyContext, "getSalesContext", async () => null);
  return JSON.parse(await executeTool("buscar_propiedades", { zona: "x" }, ctx()))[0];
}

test("precio_m2 en venta: precio / area redondeado a miles", async (t) => {
  const r = await buscar(t, { operacion: "Venta", precio: "$450.000.000", area: "62m2", titulo: "Apto" });
  assert.strictEqual(r.precio_m2, 7258000);
  assert.strictEqual(r.titulo, "Apto");
});

test("precio_m2 es null en arriendo", async (t) => {
  const r = await buscar(t, { operacion: "Arriendo", precio: "$3.500.000", area: "62m2" });
  assert.strictEqual(r.precio_m2, null);
});

test("precio_m2 es null si falta el area o el precio, o es absurdo", async (t) => {
  assert.strictEqual((await buscar(t, { operacion: "Venta", precio: "$450.000.000", area: null })).precio_m2, null);
  assert.strictEqual((await buscar(t, { operacion: "Venta", precio: null, area: "62m2" })).precio_m2, null);
  assert.strictEqual((await buscar(t, { operacion: "Venta", precio: "$450.000", area: "62m2" })).precio_m2, null);
});

test("el prompt trae el cierre de visita y ya no el Responde SI", () => {
  const p = JSON.stringify(buildSystemPrompt({ org: { name: "Diamond" }, lead: {} }));
  assert.match(p, /¿Te la muestro esta semana\? Te propongo dos horarios\./);
  assert.match(p, /precio_m2/);
  assert.doesNotMatch(p, /Responde SI/);
});
