// Los data modules (ally-properties, properties, leads, advisors) crean un
// cliente Supabase REAL si SUPABASE_URL esta en el .env (asi esta configurado
// en este repo, apuntando a produccion) — estos tests mockean sus funciones
// async para no leer/escribir contra la base real. mock.method reemplaza el
// metodo en el objeto cacheado por require(), asi que tools.js (que hace su
// propio require) ve el mock.
const { test, mock } = require("node:test");
const assert = require("node:assert");
const { executeTool } = require("../src/agent/tools");
const allyProperties = require("../src/data/ally-properties");
const properties = require("../src/data/properties");

function baseCtx() {
  return {
    org: { id: "org-1", name: "Diamond" },
    lead: { id: "lead-1", phone: "573001112233", categoria: "otros", estado: "en_conversacion", score: 0 },
    propertyInteres: null,
    transfer: null,
    cita: null,
    allyMatch: null,
    lastUserMessage: "les comparto este apto en Guatape, ref 10128030, $450.000.000 — Natalia Velez, Paraiso Inmobiliaria",
  };
}

test("registrar_propiedad_aliado: inserta el registro y NUNCA califica al lead como comprador", async (t) => {
  const created = [];
  t.mock.method(allyProperties, "create", async (orgId, fields) => {
    created.push({ orgId, fields });
    return { id: "ally-1", ...fields };
  });

  const ctx = baseCtx();
  const before = { ...ctx.lead };
  const input = {
    ref: "10128030",
    zona: "Guatape",
    ciudad: "Antioquia",
    tipo: "Apartamento",
    operacion: "Venta",
    precio: "$450.000.000",
    inmobiliaria_origen: "Paraiso Inmobiliaria",
    contacto_nombre: "Natalia Velez",
  };

  const result = await executeTool("registrar_propiedad_aliado", input, ctx);

  assert.strictEqual(created.length, 1);
  assert.strictEqual(created[0].orgId, "org-1");
  assert.strictEqual(created[0].fields.contacto_telefono, "573001112233");
  assert.strictEqual(created[0].fields.lead_id, "lead-1");
  assert.strictEqual(created[0].fields.mensaje_original, ctx.lastUserMessage);
  assert.strictEqual(created[0].fields.ref, "10128030");
  // El lead que comparte NUNCA se califica como comprador.
  assert.deepStrictEqual(ctx.lead, before);
  assert.match(result, /agradece/i);
  assert.match(result, /no lo califiques/i);
});

test("registrar_propiedad_aliado: si falla la persistencia, no rompe la conversacion (best-effort)", async (t) => {
  t.mock.method(allyProperties, "create", async () => {
    throw new Error("tabla ally_properties no existe (migracion pendiente)");
  });
  const ctx = baseCtx();
  const result = await executeTool("registrar_propiedad_aliado", { zona: "Guatape" }, ctx);
  assert.match(result, /agradece/i);
});

test("buscar_propiedades sin resultados propios + match de aliado: aviso interno sin fuga de datos al modelo", async (t) => {
  t.mock.method(properties, "search", async () => []);
  t.mock.method(allyProperties, "search", async () => [
    { id: "ally-2", zona: "Guatape", tipo: "Apartamento", precio: "$450.000.000", ref: "10128030", contacto_nombre: "Natalia Velez", inmobiliaria_origen: "Paraiso Inmobiliaria", contacto_telefono: "573028536489" },
  ]);

  const ctx = baseCtx();
  const result = await executeTool("buscar_propiedades", { zona: "Guatape" }, ctx);

  assert.match(result, /AVISO INTERNO/);
  // El texto que ve el modelo NUNCA debe traer el precio, la ref ni el nombre
  // exactos de la propiedad del aliado — solo la instruccion textual.
  assert.doesNotMatch(result, /450\.000\.000/);
  assert.doesNotMatch(result, /10128030/);
  assert.doesNotMatch(result, /Natalia/);
  // El match SI queda disponible en ctx para la alerta interna del asesor.
  assert.strictEqual(ctx.allyMatch.ref, "10128030");
});

test("buscar_propiedades sin resultados propios y SIN match de aliado: mensaje generico de siempre", async (t) => {
  t.mock.method(properties, "search", async () => []);
  t.mock.method(allyProperties, "search", async () => []);

  const ctx = baseCtx();
  const result = await executeTool("buscar_propiedades", { zona: "Zona inexistente" }, ctx);

  assert.strictEqual(result, "No se encontraron propiedades con esos criterios en el inventario.");
  assert.strictEqual(ctx.allyMatch, null);
});

test("buscar_propiedades CON resultados propios: no consulta la red de aliados", async (t) => {
  const allySearchCalls = [];
  t.mock.method(properties, "search", async () => [
    { ref: "AP001", zona: "Guatape", disponible: true, operacion: "Venta" },
  ]);
  t.mock.method(allyProperties, "search", async (...args) => {
    allySearchCalls.push(args);
    return [];
  });

  const ctx = baseCtx();
  // Ya tiene categoria definida (no "otros"): evita que executeTool intente
  // actualizarla via leads.update (real, sin mockear) en este test.
  ctx.lead.categoria = "compra";
  const result = await executeTool("buscar_propiedades", { zona: "Guatape" }, ctx);

  assert.strictEqual(allySearchCalls.length, 0);
  assert.match(result, /AP001/);
});
