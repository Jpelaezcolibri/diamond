// Normalizacion de ofertas de grupo y caducidad en la red de aliados.
//
// Lo que probaba el corte temporal del pareo y el cliente de WAHA se fue con
// la escucha en vivo (baneo del 2026-07-30). Lo que queda es independiente del
// canal y vale igual para el export y para el reenvio.

const { test } = require("node:test");
const assert = require("node:assert");
const ofertas = require("../src/groups/ofertas");
const allyProperties = require("../src/data/ally-properties");

test("la operación se capitaliza — ally_properties lo exige por check", () => {
  // El check de la tabla acepta 'Venta' | 'Arriendo'; el clasificador devuelve
  // minúsculas. Sin normalizar, cada inserción revienta.
  assert.strictEqual(ofertas.operacionCanonica("venta"), "Venta");
  assert.strictEqual(ofertas.operacionCanonica("arriendo"), "Arriendo");
  assert.strictEqual(ofertas.operacionCanonica("ARRIENDO "), "Arriendo");
  assert.strictEqual(ofertas.operacionCanonica("permuta"), null);
  assert.strictEqual(ofertas.operacionCanonica(""), null);
});

test("el precio se guarda como texto — así lo espera la columna", () => {
  assert.strictEqual(ofertas.precioTexto(650000000), "$650.000.000");
  assert.strictEqual(ofertas.precioTexto(0), null);
});

// ══ Caducidad de las propiedades de grupo ════════════════════════════════

test("una propiedad de grupo vieja deja de ofrecerse", () => {
  const vieja = { origen: "grupo", visto_en_grupo_at: new Date(Date.now() - 40 * 86400000).toISOString() };
  const fresca = { origen: "grupo", visto_en_grupo_at: new Date().toISOString() };
  assert.strictEqual(allyProperties.vigente(vieja), false);
  assert.strictEqual(allyProperties.vigente(fresca), true);
});

test("las registradas por un asesor NO caducan — es el comportamiento histórico", () => {
  assert.strictEqual(allyProperties.vigente({ origen: "asesor", visto_en_grupo_at: null }), true);
});

test("una de grupo sin fecha de visto no se ofrece", () => {
  assert.strictEqual(allyProperties.vigente({ origen: "grupo", visto_en_grupo_at: null }), false);
});

test("la dedup de grupo va por colega + características, no por ref", () => {
  // Los mensajes de grupo casi nunca traen ref, y los colegas republican la
  // misma propiedad cada semana con "sigue disponible".
  const a = { origen: "grupo", contacto_telefono: "573001112233", tipo: "Casa", zona: "Sabaneta", precio: "$650.000.000" };
  assert.strictEqual(allyProperties.mismaPropiedadDeGrupo(a, { ...a, tipo: "casa", zona: " SABANETA " }), true);
  assert.strictEqual(allyProperties.mismaPropiedadDeGrupo(a, { ...a, zona: "Envigado" }), false);
  assert.strictEqual(allyProperties.mismaPropiedadDeGrupo({ ...a, origen: "asesor" }, a), false);
});
