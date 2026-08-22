// Respaldo de los colegas de los grupos gremiales.
//
// Lo que se fija aca: que un colega visto dos veces no se duplique, que el
// telefono pueda llegar DESPUES del primer avistamiento (medido 2026-08-22:
// 33% de los colegas no resuelven telefono al principio), y que la ausencia de
// la tabla no tumbe nada — este repo no tiene db:push y la migracion se corre
// a mano.

const { test } = require("node:test");
const assert = require("node:assert");

const memory = require("../src/data/memory");

// Limpiar el cache de módulos para permitir mock posterior
delete require.cache[require.resolve("../src/data/supabase")];
delete require.cache[require.resolve("../src/data/colegas")];

// Mockear el módulo supabase directamente en el cache como null
const Module = require("module");
const supabaseRules = require.resolve("../src/data/supabase");
require.cache[supabaseRules] = { exports: null };

const colegas = require("../src/data/colegas");

const ORG = "org-colegas-test";

function limpiar() {
  memory.colegasGrupos.length = 0;
}

test("guarda un colega nuevo con su telefono", async () => {
  limpiar();
  await colegas.upsert(ORG, { lid: "198161251463188", telefono: "573001234567", nombre: "Esteban", grupo: "SOLO POBLADO" });

  const fila = await colegas.porTelefono(ORG, "573001234567");
  assert.ok(fila, "deberia encontrarlo por telefono");
  assert.strictEqual(fila.lid, "198161251463188");
  assert.strictEqual(fila.nombre, "Esteban");
});

test("el mismo lid visto dos veces no se duplica, y suma el grupo nuevo", async () => {
  limpiar();
  await colegas.upsert(ORG, { lid: "111", telefono: null, nombre: "Ana", grupo: "SOLO BELEN" });
  await colegas.upsert(ORG, { lid: "111", telefono: null, nombre: "Ana", grupo: "SOLO LAURELES" });

  assert.strictEqual(memory.colegasGrupos.length, 1, "no debe duplicar por lid");
  assert.deepStrictEqual(memory.colegasGrupos[0].grupos.sort(), ["SOLO BELEN", "SOLO LAURELES"]);
});

test("el telefono puede llegar despues del primer avistamiento", async () => {
  limpiar();

  await colegas.upsert(ORG, { lid: "222", telefono: null, nombre: "Sin numero", grupo: "G1" });
  assert.strictEqual(await colegas.porTelefono(ORG, "573009999999"), null);

  await colegas.upsert(ORG, { lid: "222", telefono: "573009999999", nombre: "Sin numero", grupo: "G1" });
  const fila = await colegas.porTelefono(ORG, "573009999999");
  assert.ok(fila);
  assert.strictEqual(fila.lid, "222");
});

test("un telefono que ya estaba NO se borra si despues llega null", async () => {
  // Si un refresco de participantes viene sin `pn`, perder el numero que ya
  // teniamos seria un retroceso silencioso.
  limpiar();

  await colegas.upsert(ORG, { lid: "333", telefono: "573001112222", nombre: "X", grupo: "G1" });
  await colegas.upsert(ORG, { lid: "333", telefono: null, nombre: "X", grupo: "G1" });

  const fila = await colegas.porTelefono(ORG, "573001112222");
  assert.ok(fila, "el telefono ya conocido tiene que sobrevivir a un refresco sin pn");
});

test("porTelefono compara numeros con formatos distintos", async () => {
  limpiar();

  await colegas.upsert(ORG, { lid: "444", telefono: "573001234567", nombre: "Y", grupo: "G1" });
  assert.ok(await colegas.porTelefono(ORG, "+57 300 123 4567"), "deberia normalizar el formato");
});

test("porTelefono no cruza organizaciones", async () => {
  limpiar();

  await colegas.upsert(ORG, { lid: "555", telefono: "573005555555", nombre: "Z", grupo: "G1" });
  assert.strictEqual(await colegas.porTelefono("otra-org", "573005555555"), null);
});

test("listarConTelefono devuelve solo los resueltos", async () => {
  limpiar();

  await colegas.upsert(ORG, { lid: "a", telefono: "573001111111", nombre: "Con", grupo: "G1" });
  await colegas.upsert(ORG, { lid: "b", telefono: null, nombre: "Sin", grupo: "G1" });

  const lista = await colegas.listarConTelefono(ORG);
  assert.strictEqual(lista.length, 1);
  assert.strictEqual(lista[0].lid, "a");
});

test("sin lid no escribe nada", async () => {
  limpiar();

  await colegas.upsert(ORG, { lid: "", telefono: "573001234567", nombre: "N", grupo: "G1" });
  assert.strictEqual(memory.colegasGrupos.length, 0);
});
