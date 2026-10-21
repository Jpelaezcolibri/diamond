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

// El plazo para confirmar con el propietario (Juan, 2026-10-21): la visita
// menos 12 h, llevado a horario habil (20:00 de la vispera si cae de noche),
// nunca antes de 2 h despues del pedido.
const MIE_10 = new Date("2026-10-21T15:00:00Z"); // miercoles 21, 10:00 Bogota
test("corte: 12 h antes cuando cae de día", () => {
  // Visita (hipotetica) jueves 22:00 -> jueves 10:00.
  assert.strictEqual(r.corteDe("2026-10-23T03:00:00Z", { ahora: MIE_10 }), "2026-10-22T15:00:00.000Z");
  // Visita viernes 08:00 -> jueves 20:00 justo.
  assert.strictEqual(r.corteDe("2026-10-24T13:00:00Z", { ahora: MIE_10 }), "2026-10-24T01:00:00.000Z");
});

test("corte: si 12 h antes cae de noche, pasa a las 20:00 de la víspera", () => {
  // Visita jueves 10:00 -> 22:00 del miercoles -> miercoles 20:00.
  assert.strictEqual(r.corteDe("2026-10-23T15:00:00Z", { ahora: MIE_10 }), "2026-10-23T01:00:00.000Z");
  // Visita jueves 16:00 -> 04:00 del jueves -> miercoles 20:00.
  assert.strictEqual(r.corteDe("2026-10-23T21:00:00Z", { ahora: MIE_10 }), "2026-10-23T01:00:00.000Z");
  // Visita jueves 19:30 -> 07:30 -> miercoles 20:00.
  assert.strictEqual(r.corteDe("2026-10-24T00:30:00Z", { ahora: MIE_10 }), "2026-10-23T01:00:00.000Z");
});

test("corte: nunca antes de 2 h después del pedido, y si eso cae de noche pasa a las 08:00", () => {
  // Pedido miercoles 15:00, visita jueves 15:00: mie 20:00 sirve (pedido + 2 h = 17:00).
  assert.strictEqual(r.corteDe("2026-10-23T20:00:00Z", { ahora: new Date("2026-10-22T20:00:00Z") }), "2026-10-23T01:00:00.000Z");
  // Pedido miercoles 19:00, visita jueves 19:30: mie 20:00 es antes de 21:00
  // (pedido + 2 h), y 21:00 es de noche -> jueves 08:00.
  assert.strictEqual(r.corteDe("2026-10-24T00:30:00Z", { ahora: new Date("2026-10-23T00:00:00Z") }), "2026-10-23T13:00:00.000Z");
  // Pedido a las 06:00 (madrugada) para el dia siguiente a las 08:00: la regla da
  // la vispera 20:00 = hoy 20:00, sin tocar el minimo.
  assert.strictEqual(r.corteDe("2026-10-23T13:00:00Z", { ahora: new Date("2026-10-22T11:00:00Z") }), "2026-10-23T01:00:00.000Z");
});

test("corte: CITAS_CORTE_HORAS_ANTES por defecto 12", () => {
  assert.strictEqual(r.CORTE_HORAS_ANTES, 12);
});

test("corte en palabras: hoy, mañana o el día con fecha", () => {
  assert.strictEqual(r.corteEnPalabras("2026-10-22T01:00:00.000Z", { ahora: MIE_10 }), "hoy a las 8:00 p. m.");
  assert.strictEqual(r.corteEnPalabras("2026-10-22T13:00:00.000Z", { ahora: MIE_10 }), "mañana a las 8:00 a. m.");
  assert.strictEqual(r.corteEnPalabras("2026-10-23T01:00:00.000Z", { ahora: MIE_10 }), "mañana a las 8:00 p. m.");
  assert.strictEqual(r.corteEnPalabras("2026-10-24T01:00:00.000Z", { ahora: MIE_10 }), "el viernes 23 de octubre a las 8:00 p. m.");
});

// --- espaciar: las opciones ofrecidas quedan en distinta franja o dia ---
const slotsDia = (fecha, horas) => horas.map((h) => `${fecha}T${String(h + 5).padStart(2, "0")}:00:00Z`);

test("espaciar: todo libre da manana, tarde y el dia siguiente", () => {
  const libres = [...slotsDia("2026-10-08", [8, 9, 10, 11, 12, 13, 14]), ...slotsDia("2026-10-09", [8, 9, 10])];
  assert.deepStrictEqual(r.espaciar(libres), ["2026-10-08T13:00:00Z", "2026-10-08T17:00:00Z", "2026-10-09T13:00:00Z"]);
});

test("espaciar: solo mananas libres da tres mananas de dias distintos", () => {
  const libres = [...slotsDia("2026-10-08", [8, 9, 10]), ...slotsDia("2026-10-09", [8, 9]), ...slotsDia("2026-10-10", [8])];
  assert.deepStrictEqual(r.espaciar(libres), ["2026-10-08T13:00:00Z", "2026-10-09T13:00:00Z", "2026-10-10T13:00:00Z"]);
});

test("espaciar: tarde de hoy llena y tarde de manana libre: la opcion 2 es manana en la tarde", () => {
  const libres = [...slotsDia("2026-10-08", [8, 9, 10]), ...slotsDia("2026-10-09", [8, 9, 14, 15]), ...slotsDia("2026-10-10", [8])];
  assert.deepStrictEqual(r.espaciar(libres), ["2026-10-08T13:00:00Z", "2026-10-09T19:00:00Z", "2026-10-10T13:00:00Z"]);
});

test("espaciar: sin libres devuelve vacio, y con uno solo devuelve uno", () => {
  assert.deepStrictEqual(r.espaciar([]), []);
  assert.deepStrictEqual(r.espaciar(["2026-10-08T15:00:00.000Z"]), ["2026-10-08T15:00:00.000Z"]);
});
