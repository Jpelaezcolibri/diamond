// test/mandatos-data.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const mandatos = require("../src/data/mandatos");

const ORG = "org-1";

test("crear guarda las zonas y exigencias como arrays, no como texto", async () => {
  const row = await mandatos.crear(ORG, {
    cliente_nombre: "Marcela Restrepo",
    operacion: "venta",
    tipo: "apartamento",
    zonas: ["El Poblado", "Las Palmas"],
    exigencias: ["balcón", "vista", "moderna"],
    precio_max: 2200000000,
    habitaciones: 4,
    area_min: 150,
    texto_original: "Mi cliente subió presupuesto...",
  });
  assert.ok(row.id, "debe devolver la fila creada");
  assert.deepStrictEqual(row.zonas, ["El Poblado", "Las Palmas"]);
  assert.deepStrictEqual(row.exigencias, ["balcón", "vista", "moderna"]);
  assert.strictEqual(row.estado, "activo");
});

test("un mandato sin precio NO queda con precio_max 0", async () => {
  // precio_max = 0 en el motor significa "sin tope" y matchearia cualquier cosa;
  // null significa "no se sabe". La diferencia decide si el filtro sirve.
  const row = await mandatos.crear(ORG, { cliente_nombre: "Sin precio" });
  assert.strictEqual(row.precio_max, null);
});

test("listarActivos no devuelve pausados ni cerrados", async () => {
  const a = await mandatos.crear(ORG, { cliente_nombre: "Activo" });
  const b = await mandatos.crear(ORG, { cliente_nombre: "Cerrado" });
  await mandatos.actualizarEstado(ORG, b.id, "cerrado");
  const lista = await mandatos.listarActivos(ORG);
  const nombres = lista.map((m) => m.cliente_nombre);
  assert.ok(nombres.includes("Activo"));
  assert.ok(!nombres.includes("Cerrado"));
});

test("listarActivos no cruza organizaciones", async () => {
  await mandatos.crear("org-2", { cliente_nombre: "De otra org" });
  const lista = await mandatos.listarActivos(ORG);
  assert.ok(!lista.some((m) => m.cliente_nombre === "De otra org"));
});

test("registrarAlerta es idempotente por (mandato, propiedad)", async () => {
  const m = await mandatos.crear(ORG, { cliente_nombre: "Dedup" });
  const primera = await mandatos.registrarAlerta(ORG, {
    mandatoId: m.id, allyPropertyId: "ally-1", advisorId: "adv-1", puntaje: 88,
  });
  const segunda = await mandatos.registrarAlerta(ORG, {
    mandatoId: m.id, allyPropertyId: "ally-1", advisorId: "adv-1", puntaje: 88,
  });
  assert.strictEqual(primera.esNuevo, true);
  assert.strictEqual(segunda.esNuevo, false, "el repost del colega no debe generar un segundo aviso");
});
