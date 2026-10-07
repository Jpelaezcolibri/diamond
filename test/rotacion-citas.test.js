// Rotacion de citas entre los asesores con recibe_citas (Juan, 2026-10-07).
const { test } = require("node:test");
const assert = require("node:assert");
const rot = require("../src/data/rotacion-citas");

const H = { dias: [0, 1, 2, 3, 4, 5, 6], desde: "08:00", hasta: "18:00" };
const A1 = { id: "a1", name: "Daiana", auth_user_id: "u1", orden_citas: 1, horario: H };
const A2 = { id: "a2", name: "Claudia", auth_user_id: null, orden_citas: 2, horario: H };
const A3 = { id: "a3", name: "Catherine", auth_user_id: "u3", orden_citas: 3, horario: H };
const CICLO = [A1, A2, A3];
const AHORA = new Date("2026-10-07T15:00:00Z");
const VISITA = "2026-10-09T16:00:00Z";

test("ocupadas reconoce la cita por asesor_id y, en las viejas, por el auth del CRM", () => {
  const citas = [
    { id: "l1", cita: { asesor_id: "a2", fecha_hora: "2026-10-09T14:00:00Z", estado: "propuesta" } },
    { id: "l2", cita: { advisor_id: "u1", fecha_hora: "2026-10-09T18:00:00Z", estado: "confirmada" } },
    { id: "l3", cita: { asesor_id: "a2", fecha_hora: "2026-10-09T20:00:00Z", estado: "cancelada" } },
  ];
  assert.deepStrictEqual(rot.ocupadasDe(citas, A2, {}), ["2026-10-09T14:00:00Z"]);
  assert.deepStrictEqual(rot.ocupadasDe(citas, A1, {}), ["2026-10-09T18:00:00Z"]);
});

test("elegirAsesor: el que tiene la hora libre y menos citas", () => {
  const citas = [{ id: "l1", cita: { asesor_id: "a1", fecha_hora: "2026-10-10T14:00:00Z", estado: "confirmada" } }];
  assert.strictEqual(rot.elegirAsesor({ ciclo: CICLO, citasOrg: citas, fechaHoraIso: VISITA, ahora: AHORA }).id, "a2");
});

test("elegirAsesor: salta al que tiene la hora ocupada", () => {
  const citas = [{ id: "l1", cita: { asesor_id: "a2", fecha_hora: VISITA, estado: "propuesta" } }];
  assert.strictEqual(rot.elegirAsesor({ ciclo: CICLO, citasOrg: citas, fechaHoraIso: VISITA, ahora: AHORA }).id, "a1");
});

test("elegirAsesor: nadie puede si no hay 24 h", () => {
  assert.strictEqual(rot.elegirAsesor({ ciclo: CICLO, citasOrg: [], fechaHoraIso: "2026-10-07T20:00:00Z", ahora: AHORA }), null);
});

test("siguiente: circular 1→2→3→1 saltando al que tiene la hora ocupada", () => {
  assert.strictEqual(rot.siguiente({ ciclo: CICLO, actualId: "a1", citasOrg: [], fechaHoraIso: VISITA, ahora: AHORA }).id, "a2");
  assert.strictEqual(rot.siguiente({ ciclo: CICLO, actualId: "a3", citasOrg: [], fechaHoraIso: VISITA, ahora: AHORA }).id, "a1");
  const ocupaA2 = [{ id: "x", cita: { asesor_id: "a2", fecha_hora: VISITA, estado: "confirmada" } }];
  assert.strictEqual(rot.siguiente({ ciclo: CICLO, actualId: "a1", citasOrg: ocupaA2, fechaHoraIso: VISITA, ahora: AHORA }).id, "a3");
});

test("siguiente: con un solo asesor posible, se queda en el actual", () => {
  assert.strictEqual(rot.siguiente({ ciclo: [A1], actualId: "a1", citasOrg: [], fechaHoraIso: VISITA, ahora: AHORA }).id, "a1");
});
