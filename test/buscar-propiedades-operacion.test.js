// BUG real (2026-10-17). buscar_propiedades no tenia como pedir venta o
// arriendo y devuelve 5 filas: un cliente que buscaba arriendo en Laureles
// recibia 5 apartamentos en VENTA y Sofi nunca veia los 3 arriendos
// amoblados de Laureles (10383636, 10392197, 10488342). Solo funcionaba si el
// cliente daba presupuesto, porque el precio separaba una cosa de la otra.

const { test } = require("node:test");
const assert = require("node:assert");
const { TOOL_DEFINITIONS, executeTool } = require("../src/agent/tools");
const properties = require("../src/data/properties");
const allyProperties = require("../src/data/ally-properties");

const ctx = () => ({
  org: { id: "org-1", name: "Diamond" },
  lead: { id: "lead-1", phone: "573001112233", categoria: "otros", estado: "en_conversacion", score: 0 },
  propertyInteres: null, transfer: null, cita: null, allyMatch: null, allyAlert: null, lastUserMessage: "",
});

test("buscar_propiedades le deja a Sofi pedir venta o arriendo", () => {
  const def = TOOL_DEFINITIONS.find((t) => t.name === "buscar_propiedades");
  const op = def.input_schema.properties.operacion;
  assert.ok(op, "falta el parametro operacion");
  assert.deepStrictEqual(op.enum, ["venta", "arriendo"]);
  assert.match(def.description, /arriendo/i);
});

test("la operacion que pide Sofi llega a la busqueda del inventario", async (t) => {
  let filtros = null;
  t.mock.method(properties, "search", async (_org, f) => { filtros = f; return []; });
  t.mock.method(allyProperties, "search", async () => []);
  await executeTool("buscar_propiedades", { zona: "Laureles", operacion: "arriendo" }, ctx());
  assert.strictEqual(filtros.operacion, "arriendo");
  assert.strictEqual(filtros.zona, "Laureles");
});
