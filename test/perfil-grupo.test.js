// Perfil del grupo para el publicador (spec 2026-10-26-publicador-mixto §3).
const { test } = require("node:test");
const assert = require("node:assert");
const { perfilDe } = require("../src/groups/perfil-grupo");

const g = (nombre, publica = "ofertas", perfil = null) => ({ nombre, publica, perfil });

test("OFERTAS SUR POB ENV SAB: Poblado, Envigado, Sabaneta y el sur", () => {
  const p = perfilDe(g("OFERTAS SUR POB ENV SAB"));
  for (const z of ["El Poblado", "Envigado", "Sabaneta", "La Estrella", "Itagüí", "Caldas"]) assert.ok(p.zonas.includes(z), z);
  assert.strictEqual(p.operacion, null);
});

test("sin palabra de zona acepta todas", () => {
  assert.deepStrictEqual(perfilDe(g("OFERTAS 7:00 A.M.8:00P.M.")).zonas, []);
  assert.deepStrictEqual(perfilDe(g("ARRIENDOS 7AM 8PM", "arriendos")).zonas, []);
});

test("palabra completa: 'SABANETA' sí, 'SABADO' no; tildes no importan", () => {
  assert.deepStrictEqual(perfilDe(g("SOLO SABANETA")).zonas, ["Sabaneta"]);
  assert.deepStrictEqual(perfilDe(g("Pedidos del SABADO")).zonas, []);
  assert.deepStrictEqual(perfilDe(g("SOLO BELÉN")).zonas, ["Belén"]);
});

test("NORTE solo con ANT; OCCIDENTE y ORIENTE", () => {
  assert.ok(perfilDe(g("FINCAS NORTE ANT 7AM 8PM", "fincas")).zonas.includes("Bello"));
  assert.deepStrictEqual(perfilDe(g("Bodegas zona NORTE")).zonas, []);
  assert.ok(perfilDe(g("OCCIDENTE 2", "fincas")).zonas.includes("San Jerónimo"));
  assert.ok(perfilDe(g("PEDIDOS ORIENTE", "fincas")).zonas.includes("Rionegro"));
});

test("operación por nombre; si dice venta y renta decide la categoría", () => {
  assert.strictEqual(perfilDe(g("ARRIENDOS 7AM 8PM", "arriendos")).operacion, "arriendo");
  assert.strictEqual(perfilDe(g("SOLO VENTAS", "ofertas")).operacion, "venta");
  assert.strictEqual(perfilDe(g("Renta y Venta Amoblados y Airbnb", "amoblados")).operacion, "arriendo");
  assert.strictEqual(perfilDe(g("Renta y Venta", "ofertas")).operacion, null);
});

test("el override manual manda campo por campo", () => {
  const p = perfilDe(g("OFERTAS SUR POB ENV SAB", "ofertas", { zonas: ["Laureles"], operacion: "venta" }));
  assert.deepStrictEqual(p.zonas, ["Laureles"]);
  assert.strictEqual(p.operacion, "venta");
  assert.deepStrictEqual(perfilDe(g("X", "ofertas", { tipos: ["Casa"] })).tipos, ["Casa"]);
});

test("los pedidos del grupo viajan en el perfil", () => {
  const pedidos = [{ operacion: "venta", zona: "Envigado" }];
  assert.deepStrictEqual(perfilDe(g("X"), pedidos).pedidos, pedidos);
});
