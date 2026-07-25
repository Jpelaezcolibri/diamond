// Rotacion de transferencias organicas (decision 2026-07-25): solo los
// asesores con recibe_transferencias !== false entran al round-robin de su
// especialidad; el reparto es uno a uno segun el ultimo transferido.
const { test } = require("node:test");
const assert = require("node:assert");
const { rotationCandidates, nextInRotation } = require("../src/data/advisors");

const NATALIA = { id: "adv-natalia", name: "Natalia", especialidad: "venta", activo: true };
const DANNA = { id: "adv-danna", name: "Danna", especialidad: "venta", activo: true };
const CLAUDIA = { id: "adv-claudia", name: "Claudia", especialidad: "venta", activo: true, recibe_transferencias: false };
const VIEJO = { id: "adv-viejo", name: "Asesor de Ventas Diamond", especialidad: "venta", activo: true, recibe_transferencias: false };
const ARRIENDO = { id: "adv-arr", name: "Arriendos", especialidad: "arriendo", activo: true };

const LIST = [VIEJO, CLAUDIA, NATALIA, DANNA, ARRIENDO];

test("rotationCandidates: excluye recibe_transferencias=false y otras especialidades", () => {
  const rot = rotationCandidates(LIST, "venta");
  assert.deepStrictEqual(rot.map((a) => a.id).sort(), ["adv-danna", "adv-natalia"]);
});

test("rotationCandidates: sin columna (undefined) cuenta como true — compatibilidad pre-migracion", () => {
  const rot = rotationCandidates([NATALIA, DANNA], "venta");
  assert.strictEqual(rot.length, 2);
});

test("nextInRotation: reparte uno a uno segun el ultimo transferido", () => {
  const rot = rotationCandidates(LIST, "venta");
  const primero = nextInRotation(rot, null);
  const segundo = nextInRotation(rot, primero.id);
  const tercero = nextInRotation(rot, segundo.id);
  assert.notStrictEqual(primero.id, segundo.id);
  assert.strictEqual(tercero.id, primero.id); // con 2 asesores, alterna
});

test("nextInRotation: lastId desconocido (asesor sacado de la rotacion) arranca del primero", () => {
  const rot = rotationCandidates(LIST, "venta");
  const pick = nextInRotation(rot, "adv-claudia");
  assert.ok(["adv-natalia", "adv-danna"].includes(pick.id));
});

test("nextInRotation: rotacion de uno siempre devuelve ese", () => {
  const rot = rotationCandidates(LIST, "arriendo");
  assert.strictEqual(nextInRotation(rot, null).id, "adv-arr");
  assert.strictEqual(nextInRotation(rot, "adv-arr").id, "adv-arr");
});
