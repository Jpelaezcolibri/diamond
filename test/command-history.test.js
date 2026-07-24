// Corte de "hoy + ayer" en hora de Bogota para la carga inicial del chat de
// Sofi en el CRM (el resto del historial se pagina hacia atras).
const { test } = require("node:test");
const assert = require("node:assert");
const { bogotaYesterdayStartIso } = require("../src/data/command");

test("bogotaYesterdayStartIso: medianoche de ayer en Bogota (UTC-5)", () => {
  // 2026-07-24 15:00 Bogota = 2026-07-24T20:00:00Z → ayer arranca 2026-07-23T00:00-05:00
  const nowMs = Date.parse("2026-07-24T20:00:00Z");
  assert.strictEqual(bogotaYesterdayStartIso(nowMs), "2026-07-23T05:00:00.000Z");
});

test("bogotaYesterdayStartIso: cerca de medianoche UTC no se corre de dia", () => {
  // 2026-07-25T02:00Z todavia es 2026-07-24 en Bogota (21:00) → ayer = 07-23
  const nowMs = Date.parse("2026-07-25T02:00:00Z");
  assert.strictEqual(bogotaYesterdayStartIso(nowMs), "2026-07-23T05:00:00.000Z");
});

test("bogotaYesterdayStartIso: pasada la medianoche de Bogota cambia el corte", () => {
  // 2026-07-25T05:30Z = 00:30 en Bogota del 25 → ayer = 07-24
  const nowMs = Date.parse("2026-07-25T05:30:00Z");
  assert.strictEqual(bogotaYesterdayStartIso(nowMs), "2026-07-24T05:00:00.000Z");
});
