// Logica pura de validacion de agenda (horario + choques). checkAvailability
// toca Supabase real (env apunta a prod), asi que aca se prueban solo las
// funciones puras que componen su decision — mismo criterio que el resto de
// src/data/*.
const { test } = require("node:test");
const assert = require("node:assert");
const { dentroDeHorario, hayChoque, DEFAULT_HORARIO } = require("../src/data/appointments");

// 2026-07-23 es JUEVES. Horas en offset Colombia (-05:00).
const juevesRef = (hhmm) => `2026-07-23T${hhmm}:00-05:00`;

test("dentroDeHorario: jueves 10:00 con default L-V 8-18 es valido", () => {
  assert.strictEqual(dentroDeHorario(DEFAULT_HORARIO, juevesRef("10:00")), true);
});

test("dentroDeHorario: 07:30 (antes de las 8) queda fuera", () => {
  assert.strictEqual(dentroDeHorario(DEFAULT_HORARIO, juevesRef("07:30")), false);
});

test("dentroDeHorario: 17:30 con visita de 1h terminaria 18:30 (pasa las 18) -> fuera", () => {
  assert.strictEqual(dentroDeHorario(DEFAULT_HORARIO, juevesRef("17:30")), false);
});

test("dentroDeHorario: 17:00 cabe justo (termina 18:00) -> valido", () => {
  assert.strictEqual(dentroDeHorario(DEFAULT_HORARIO, juevesRef("17:00")), true);
});

test("dentroDeHorario: domingo (no en dias) queda fuera aunque sea media manana", () => {
  // 2026-07-26 es domingo.
  assert.strictEqual(dentroDeHorario(DEFAULT_HORARIO, "2026-07-26T10:00:00-05:00"), false);
});

test("dentroDeHorario: horario null usa el default", () => {
  assert.strictEqual(dentroDeHorario(null, juevesRef("10:00")), true);
});

test("dentroDeHorario: horario custom que incluye sabado hasta las 14", () => {
  const h = { dias: [6], desde: "09:00", hasta: "14:00" };
  // 2026-07-25 es sabado.
  assert.strictEqual(dentroDeHorario(h, "2026-07-25T09:30:00-05:00"), true);
  assert.strictEqual(dentroDeHorario(h, "2026-07-25T13:30:00-05:00"), false); // terminaria 14:30
  assert.strictEqual(dentroDeHorario(h, juevesRef("10:00")), false); // jueves no esta en dias
});

test("dentroDeHorario: ISO invalido -> false", () => {
  assert.strictEqual(dentroDeHorario(DEFAULT_HORARIO, "no-es-fecha"), false);
});

// ── hayChoque ──────────────────────────────────────────────────────────────
const AID = "adv-1";
function lead(id, advisorId, iso) {
  return { id, cita: advisorId ? { advisor_id: advisorId, fecha_hora: iso } : { fecha_hora: iso } };
}

test("hayChoque: misma agenda, misma hora exacta -> choque", () => {
  const leads = [lead("l1", AID, juevesRef("10:00"))];
  assert.strictEqual(hayChoque(leads, AID, juevesRef("10:00")), true);
});

test("hayChoque: misma agenda a 30 min (dentro de la hora) -> choque", () => {
  const leads = [lead("l1", AID, juevesRef("10:00"))];
  assert.strictEqual(hayChoque(leads, AID, juevesRef("10:30")), true);
});

test("hayChoque: misma agenda a 60 min exactos -> NO choca (ventana estricta)", () => {
  const leads = [lead("l1", AID, juevesRef("10:00"))];
  assert.strictEqual(hayChoque(leads, AID, juevesRef("11:00")), false);
});

test("hayChoque: OTRO asesor a la misma hora -> no choca", () => {
  const leads = [lead("l1", "adv-2", juevesRef("10:00"))];
  assert.strictEqual(hayChoque(leads, AID, juevesRef("10:00")), false);
});

test("hayChoque: excluye al propio lead (reagendar no choca consigo mismo)", () => {
  const leads = [lead("l1", AID, juevesRef("10:00"))];
  assert.strictEqual(hayChoque(leads, AID, juevesRef("10:15"), "l1"), false);
});

test("hayChoque: cita sin advisor_id (flujo viejo) no cuenta", () => {
  const leads = [lead("l1", null, juevesRef("10:00"))];
  assert.strictEqual(hayChoque(leads, AID, juevesRef("10:00")), false);
});
