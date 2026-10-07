// El puente del DM del radar a Sofi (spec 2026-10-07 §3): el DM lleva un
// codigo corto, y cuando el colega le escribe a Sofi con el, se lo reconoce y
// se le amarra el telefono real a su ficha.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const memory = require("../src/data/memory");
const cc = require("../src/groups/codigo-colega");

beforeEach(() => {
  memory.groupSignals.length = 0;
  memory.colegasGrupos.length = 0;
});

test("el código tiene 4 caracteres legibles (sin 0, O, 1, I)", () => {
  for (let i = 0; i < 200; i++) assert.match(cc.generarCodigo(), /^[A-HJ-NP-Z2-9]{4}$/);
});

test("lee el código del texto prellenado, sin importar mayúsculas ni tilde", () => {
  assert.strictEqual(cc.leerCodigo("Hola Sofi, quiero agendar una visita para mi PEDIDO (cód. D7K2)"), "D7K2");
  assert.strictEqual(cc.leerCodigo("hola (cod d7k2)"), "D7K2");
  assert.strictEqual(cc.leerCodigo("Hola, me interesa la 10128030"), null);
  assert.strictEqual(cc.leerCodigo(null), null);
});

test("asigna un código a la señal y lo resuelve de vuelta", async () => {
  memory.groupSignals.push({ id: "s1", org_id: "org-1", clase: "demanda", autor_nombre: "Laura", respuesta_destino_lid: "111222333444555@lid" });
  const codigo = await cc.asignarCodigo("org-1", "s1");
  assert.match(codigo, /^[A-HJ-NP-Z2-9]{4}$/);
  const s = await cc.resolver("org-1", codigo);
  assert.strictEqual(s.id, "s1");
  assert.strictEqual(await cc.resolver("org-2", codigo), null, "el código es por org");
});

test("si la señal ya tenía código, se reusa", async () => {
  memory.groupSignals.push({ id: "s1", org_id: "org-1", clase: "demanda", codigo_colega: "ABCD" });
  assert.strictEqual(await cc.asignarCodigo("org-1", "s1"), "ABCD");
});

test("reconocer: amarra el teléfono al colega que solo tenía lid y marca que escribió", async () => {
  memory.groupSignals.push({ id: "s1", org_id: "org-1", clase: "demanda", autor_nombre: "Laura Gómez", respuesta_destino_lid: "111222333444555@lid", codigo_colega: "D7K2" });
  memory.colegasGrupos.push({ id: "c1", org_id: "org-1", lid: "111222333444555", telefono: null, nombre: "Laura Gómez", grupos: [] });
  const r = await cc.reconocer("org-1", "573125550000", "Hola Sofi, quiero más opciones para mi PEDIDO (cód. D7K2)");
  assert.strictEqual(r.senal.id, "s1");
  assert.deepStrictEqual(r.colega, { lid: "111222333444555", telefono: "573125550000", nombre: "Laura Gómez" });
  assert.strictEqual(memory.colegasGrupos[0].telefono, "573125550000");
  assert.ok(memory.groupSignals[0].colega_escribio_at);
});

test("reconocer: si el colega ya tenía OTRO teléfono, no se pisa", async () => {
  memory.groupSignals.push({ id: "s1", org_id: "org-1", clase: "demanda", autor_nombre: "Laura", respuesta_destino_lid: "111222333444555@lid", codigo_colega: "D7K2" });
  memory.colegasGrupos.push({ id: "c1", org_id: "org-1", lid: "111222333444555", telefono: "573009998877", nombre: "Laura", grupos: [] });
  const r = await cc.reconocer("org-1", "573125550000", "(cód. D7K2)");
  assert.strictEqual(memory.colegasGrupos[0].telefono, "573009998877");
  assert.strictEqual(r.colega.telefono, "573125550000", "igual se lo atiende como colega en esta conversación");
});

test("reconocer: sin código o código desconocido devuelve null", async () => {
  assert.strictEqual(await cc.reconocer("org-1", "573125550000", "hola"), null);
  assert.strictEqual(await cc.reconocer("org-1", "573125550000", "(cód. ZZZZ)"), null);
});
