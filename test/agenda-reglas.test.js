// Reglas de agenda (Juan, 2026-10-07): 24 h de anticipacion, horario del
// asesor y 60 min de visita + 90 de traslado entre citas del mismo asesor.
const { test } = require("node:test");
const assert = require("node:assert");
const r = require("../src/lib/agenda-reglas");

const AHORA = new Date("2026-10-07T15:00:00Z"); // martes 10:00 Bogotá
const H = { dias: [0, 1, 2, 3, 4, 5, 6], desde: "08:00", hasta: "18:00" };

test("menos de 24 h de anticipación no se puede", () => {
  assert.deepStrictEqual(r.validarHora({ fechaHoraIso: "2026-10-08T14:00:00Z", ahora: AHORA, horario: H, ocupadas: [] }), { ok: false, motivo: "anticipacion" });
  assert.deepStrictEqual(r.validarHora({ fechaHoraIso: "2026-10-08T15:00:00Z", ahora: AHORA, horario: H, ocupadas: [] }), { ok: true });
});

test("fuera del horario del asesor no se puede", () => {
  // 19:00 Bogotá
  assert.strictEqual(r.validarHora({ fechaHoraIso: "2026-10-09T00:00:00Z", ahora: AHORA, horario: H, ocupadas: [] }).motivo, "fuera_de_horario");
});

test("dos citas del mismo asesor tienen que estar a 150 min (60 de visita + 90 de traslado)", () => {
  const ocupadas = ["2026-10-09T14:00:00Z"]; // 9:00 Bogotá
  assert.strictEqual(r.validarHora({ fechaHoraIso: "2026-10-09T16:00:00Z", ahora: AHORA, horario: H, ocupadas }).motivo, "choque"); // 11:00
  assert.deepStrictEqual(r.validarHora({ fechaHoraIso: "2026-10-09T16:30:00Z", ahora: AHORA, horario: H, ocupadas }), { ok: true }); // 11:30
  assert.strictEqual(r.validarHora({ fechaHoraIso: "2026-10-09T12:00:00Z", ahora: AHORA, horario: H, ocupadas }).motivo, "fuera_de_horario"); // 7:00
  assert.strictEqual(r.validarHora({ fechaHoraIso: "2026-10-09T13:00:00Z", ahora: AHORA, horario: H, ocupadas }).motivo, "choque"); // 8:00, 60 min antes
});

test("alternativas: las primeras 3 horas válidas desde las 24 h, cada 30 min", () => {
  const ocupadas = ["2026-10-08T15:00:00Z"];
  const alt = r.alternativas({ ahora: AHORA, horario: H, ocupadas });
  assert.strictEqual(alt.length, 3);
  for (const iso of alt) assert.deepStrictEqual(r.validarHora({ fechaHoraIso: iso, ahora: AHORA, horario: H, ocupadas }), { ok: true });
  assert.strictEqual(alt[0], "2026-10-08T17:30:00.000Z", "10:00 está ocupada; la primera libre es 12:30 Bogotá");
});

test("silencio de 20:00 a 08:00 en Bogotá", () => {
  assert.strictEqual(r.enSilencio(new Date("2026-10-08T01:30:00Z")), true); // 20:30
  assert.strictEqual(r.enSilencio(new Date("2026-10-08T12:59:00Z")), true); // 07:59
  assert.strictEqual(r.enSilencio(new Date("2026-10-08T13:00:00Z")), false); // 08:00
});

test("el corte es 4 h antes de la visita", () => {
  assert.strictEqual(r.corteDe("2026-10-09T20:00:00Z"), "2026-10-09T16:00:00.000Z");
});

// --- espaciar: las opciones ofrecidas quedan en distinta franja o dia ---
const slotsDia = (fecha, horas) => horas.map((h) => `${fecha}T${String(h + 5).padStart(2, "0")}:00:00Z`);

test("espaciar: todo libre da manana, tarde y el dia siguiente", () => {
  const libres = [...slotsDia("2026-10-08", [8, 9, 10, 11, 12, 13, 14]), ...slotsDia("2026-10-09", [8, 9, 10])];
  assert.deepStrictEqual(r.espaciar(libres), ["2026-10-08T13:00:00Z", "2026-10-08T17:00:00Z", "2026-10-09T13:00:00Z"]);
});

test("espaciar: solo mananas libres da manana de hoy y manana de otro dia", () => {
  const libres = [...slotsDia("2026-10-08", [8, 9, 10]), ...slotsDia("2026-10-09", [8, 9]), ...slotsDia("2026-10-10", [8])];
  const out = r.espaciar(libres);
  assert.deepStrictEqual(out.slice(0, 2), ["2026-10-08T13:00:00Z", "2026-10-09T13:00:00Z"]);
  assert.strictEqual(out.length, 3);
});

test("espaciar: sin libres devuelve vacio, y con uno solo devuelve uno", () => {
  assert.deepStrictEqual(r.espaciar([]), []);
  assert.deepStrictEqual(r.espaciar(["2026-10-08T15:00:00.000Z"]), ["2026-10-08T15:00:00.000Z"]);
});
