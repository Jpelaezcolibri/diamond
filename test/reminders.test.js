// Logica del motor de recordatorios de cita. isReminderDue es pura (ventana +
// flags); dueReminders/runOnce tocan Supabase/WhatsApp y no se testean directo
// (mismo criterio que el resto de src/data|scheduler).
const { test } = require("node:test");
const assert = require("node:assert");
const { isReminderDue } = require("../src/data/appointments");
const { reminderParams, tipoLabel, horaBogota } = require("../src/scheduler/reminders");

const NOW = Date.parse("2026-07-23T14:00:00-05:00"); // jueves 2:00 p.m. Colombia
const iso = (min) => new Date(NOW + min * 60000).toISOString();

function lead(cita) {
  return { id: "l1", nombre: "Marta", cita };
}

test("isReminderDue: cita a 45 min con asesor y sin avisar -> toca", () => {
  const l = lead({ fecha_hora: iso(45), advisor_id: "adv-1", tipo: "visita" });
  assert.strictEqual(isReminderDue(l, NOW, 60), true);
});

test("isReminderDue: cita a 90 min (fuera de la ventana de 60) -> no toca todavia", () => {
  const l = lead({ fecha_hora: iso(90), advisor_id: "adv-1" });
  assert.strictEqual(isReminderDue(l, NOW, 60), false);
});

test("isReminderDue: cita ya pasada -> no toca", () => {
  const l = lead({ fecha_hora: iso(-10), advisor_id: "adv-1" });
  assert.strictEqual(isReminderDue(l, NOW, 60), false);
});

test("isReminderDue: ya avisada -> no repite", () => {
  const l = lead({ fecha_hora: iso(30), advisor_id: "adv-1", recordatorio_enviado: true });
  assert.strictEqual(isReminderDue(l, NOW, 60), false);
});

test("isReminderDue: sin advisor_id (cita vieja sin dueno) -> no toca", () => {
  const l = lead({ fecha_hora: iso(30) });
  assert.strictEqual(isReminderDue(l, NOW, 60), false);
});

test("isReminderDue: sin cita o sin fecha -> no toca", () => {
  assert.strictEqual(isReminderDue({ id: "x" }, NOW, 60), false);
  assert.strictEqual(isReminderDue(lead({ advisor_id: "adv-1" }), NOW, 60), false);
});

// HALLAZGO 1 (review 2026-09-04): el recordatorio ignoraba el estado. Una cita
// que se cancelo ayer desde el CRM desaparecia del calendario pero HOY, una
// hora antes, le llegaba igual al asesor la plantilla `recordatorio_cita`
// diciendo "visita con Marta a las 3:00 p.m.". Es "la agenda que miente"
// entregada por WhatsApp — el incidente exacto que origino esta rama.
test("isReminderDue: una cita CANCELADA no dispara el recordatorio al asesor", () => {
  const l = lead({ fecha_hora: iso(45), advisor_id: "adv-1", tipo: "visita", estado: "cancelada" });
  assert.strictEqual(isReminderDue(l, NOW, 60), false);
});

// Los otros tres estados SI siguen vivos: una propuesta todavia puede
// confirmarse y una reprogramada es una cita real movida de hora. Y una cita
// sin `estado` —todas las de produccion— se lee como confirmada (src/data/citas.js).
test("isReminderDue: propuesta, confirmada, reprogramada y sin estado si recuerdan", () => {
  for (const estado of ["propuesta", "confirmada", "reprogramada", undefined]) {
    const l = lead({ fecha_hora: iso(45), advisor_id: "adv-1", tipo: "visita", estado });
    assert.strictEqual(isReminderDue(l, NOW, 60), true, `estado=${estado}`);
  }
});

test("reminderParams: arma los 4 valores en orden asesor/tipo/cliente/hora", () => {
  const advisor = { name: "Camila", phone: "573009990000" };
  const l = lead({ fecha_hora: "2026-07-23T15:00:00-05:00", advisor_id: "adv-1", tipo: "visita" });
  const p = reminderParams(advisor, l);
  assert.strictEqual(p.length, 4);
  assert.strictEqual(p[0], "Camila");
  assert.strictEqual(p[1], "visita");
  assert.strictEqual(p[2], "Marta");
  assert.match(p[3], /3:00/); // 3:00 p. m. en Bogota
});

test("tipoLabel: mapea tipos y cae a 'cita' si no reconoce", () => {
  assert.strictEqual(tipoLabel("visita"), "visita");
  assert.strictEqual(tipoLabel("asesoria"), "asesoría");
  assert.strictEqual(tipoLabel(undefined), "cita");
});

test("horaBogota: convierte ISO a hora local Colombia", () => {
  assert.match(horaBogota("2026-07-23T20:00:00Z"), /3:00/); // 20:00 UTC = 15:00 Bogota
});
