const { test } = require("node:test");
const assert = require("node:assert");
const { computeScore, isQualified } = require("../src/agent/qualification");

test("lead vacio no califica y tiene score 0", () => {
  const lead = {};
  assert.strictEqual(computeScore(lead), 0);
  assert.strictEqual(isQualified(lead), false);
});

test("presupuesto + urgencia + zona califica", () => {
  const lead = { presupuesto: "$1.200.000", urgencia: "este mes", zona_interes: "El Poblado" };
  assert.strictEqual(isQualified(lead), true);
  assert.strictEqual(computeScore(lead), 75);
});

test("presupuesto + urgencia sin preferencia NO califica", () => {
  const lead = { presupuesto: "$1.200.000", urgencia: "este mes" };
  assert.strictEqual(isQualified(lead), false);
});

test("tipo_interes cuenta como preferencia", () => {
  const lead = { presupuesto: "$900.000", urgencia: "ya", tipo_interes: "Apartaestudio" };
  assert.strictEqual(isQualified(lead), true);
});

test("score completo suma 100", () => {
  const lead = {
    nombre: "Ana", presupuesto: "$1.000.000", zona_interes: "Laureles",
    tipo_interes: "Apartamento", urgencia: "inmediata",
  };
  assert.strictEqual(computeScore(lead), 100);
});

test("cierre directo: propiedad de origen + forma de pago califica", () => {
  const lead = { property_ref_origen: "AP001", forma_pago: "credito hipotecario" };
  assert.strictEqual(isQualified(lead), true);
});

test("lead calificado por cierre directo tiene score minimo 70", () => {
  const lead = { property_ref_origen: "AP001", forma_pago: "credito hipotecario" };
  assert.ok(computeScore(lead) >= 70);
});

test("forma de pago sola NO califica sin propiedad de origen", () => {
  const lead = { forma_pago: "recursos propios" };
  assert.strictEqual(isQualified(lead), false);
});

test("el score no supera 100 con todos los campos", () => {
  const lead = {
    nombre: "Ana", presupuesto: "$1.000.000", zona_interes: "Laureles",
    tipo_interes: "Apartamento", urgencia: "inmediata", forma_pago: "credito",
  };
  assert.strictEqual(computeScore(lead), 100);
});
