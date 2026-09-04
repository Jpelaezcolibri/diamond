// LA CITA NO TENIA ESTADO (Juan, 2026-09-04). `leads.cita.estado` se escribia
// UNA vez como "solicitada" (src/agent/tools.js) y nadie lo volvia a tocar: no
// habia forma de cancelar nada. El calendario del equipo ni siquiera leia el
// campo, asi que la visita cancelada de hoy se seguia mostrando como si fuera
// a ocurrir.
const { test } = require("node:test");
const assert = require("node:assert");
const citas = require("../src/data/citas");

// RETROCOMPATIBILIDAD: las citas que ya estan en la base no tienen estado.
// Se leen como confirmada porque es lo que el equipo asumio todo este tiempo
// — inventar otra cosa seria reescribir la historia.
test("una cita sin estado se lee como confirmada", () => {
  assert.strictEqual(citas.estadoDe({ fecha_hora: "2026-09-10T15:00:00-05:00" }), "confirmada");
  assert.strictEqual(citas.estadoDe({ estado: "solicitada" }), "confirmada");
});

test("un estado desconocido tampoco rompe: se lee como confirmada", () => {
  assert.strictEqual(citas.estadoDe({ estado: "cualquier-cosa" }), "confirmada");
});

test("los cuatro estados validos se leen tal cual", () => {
  for (const e of citas.ESTADOS) assert.strictEqual(citas.estadoDe({ estado: e }), e);
});

// `estaViva` es lo que van a consultar el calendario y el anti-choque de la
// agenda: una cancelada no ocupa espacio ni se muestra.
test("solo la cancelada deja de estar viva", () => {
  assert.strictEqual(citas.estaViva({ estado: "cancelada" }), false);
  assert.strictEqual(citas.estaViva({ estado: "propuesta" }), true);
  assert.strictEqual(citas.estaViva({ estado: "confirmada" }), true);
  assert.strictEqual(citas.estaViva({ estado: "reprogramada" }), true);
  assert.strictEqual(citas.estaViva({}), true, "una cita vieja sigue viva");
});

test("una cita nula no esta viva y no revienta", () => {
  assert.strictEqual(citas.estaViva(null), false);
  assert.strictEqual(citas.estadoDe(null), "confirmada");
});
