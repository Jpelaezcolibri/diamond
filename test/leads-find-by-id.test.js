// leads.findById contra el MODULO REAL, sin mockear nada (Juan, 2026-09-04).
//
// Por que este archivo existe aparte de test/cancelar-cita.test.js: ese test
// inyecta un doble de `src/data/leads.js` en require.cache, asi que pasaba en
// verde mientras la funcion NO existia en el modulo real — en produccion
// `leads.findById(...)` era un TypeError sincrono que ni siquiera caia en el
// `.catch()` de cancelar-cita.js. Un test que mockea la dependencia no puede
// ver ese hueco por construccion; hace falta uno que cargue el modulo de
// verdad.
//
// Bajo `node --test` no hay cliente de Supabase (ver la guarda de red en
// src/data/supabase.js), asi que estos casos ejercitan la rama de memoria
// —la misma que usa el modo demo— y la firma publica.
const { test } = require("node:test");
const assert = require("node:assert");

const leads = require("../src/data/leads");
const memory = require("../src/data/memory");

test("leads exporta findById con la firma (orgId, id) del resto de src/data", () => {
  assert.strictEqual(typeof leads.findById, "function", "src/data/leads.js no exporta findById");
  // Dos parametros, igual que advisors.js#findById y mandatos.js#findById. La
  // convencion no es cosmetica: este repo es multi-tenant y un findById sin
  // orgId puede devolver la fila de otra organizacion.
  assert.strictEqual(leads.findById.length, 2, "findById debe tomar (orgId, id) como el resto de src/data");
});

test("findById devuelve el lead de esa org", async () => {
  const lead = { id: memory.uid(), org_id: "org-find-1", phone: "573147815403", nombre: "Miguel" };
  memory.leads.push(lead);
  const hallado = await leads.findById("org-find-1", lead.id);
  assert.strictEqual(hallado && hallado.id, lead.id);
  assert.strictEqual(hallado.nombre, "Miguel");
});

test("findById no cruza organizaciones", async () => {
  const lead = { id: memory.uid(), org_id: "org-find-2", phone: "573147815404", nombre: "Ajena" };
  memory.leads.push(lead);
  assert.strictEqual(await leads.findById("org-find-3", lead.id), null, "el lead de otra org no puede aparecer");
});

test("findById devuelve null cuando no encuentra nada", async () => {
  assert.strictEqual(await leads.findById("org-find-1", "no-existe"), null);
  // Sin id no hay nada que buscar: null, nunca la primera fila de la tabla.
  assert.strictEqual(await leads.findById("org-find-1", null), null);
});
