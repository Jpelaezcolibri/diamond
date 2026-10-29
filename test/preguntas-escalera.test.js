// Escalera de una pregunta al asesor (spec 2026-10-25 §5.3): reaviso a los
// 15 min, rota cada hora, sin limite; pausa de noche y domingo.
const { test } = require("node:test");
const assert = require("node:assert");
const { pasoDePregunta } = require("../src/lib/preguntas-escalera");

const A1 = { id: "a1", name: "Daiana" };
const A2 = { id: "a2", name: "Claudia" };
const A3 = { id: "a3", name: "Catherine" };
const CICLO = [A1, A2, A3];
// Jueves 2026-10-08, 9:00 a. m. Bogota = 14:00 UTC.
const p = (over = {}) => ({ id: "p1", estado: "pendiente", asesor_id: "a1", asignada_at: "2026-10-08T14:00:00Z", reaviso_at: null, ...over });
const t = (iso) => new Date(iso);

test("antes de 15 min no pasa nada", () => {
  assert.strictEqual(pasoDePregunta({ pregunta: p(), ciclo: CICLO, ahora: t("2026-10-08T14:14:00Z") }).accion, "nada");
});

test("a los 15 min se le repite, una sola vez por asignación", () => {
  assert.strictEqual(pasoDePregunta({ pregunta: p(), ciclo: CICLO, ahora: t("2026-10-08T14:15:00Z") }).accion, "reaviso");
  const ya = p({ reaviso_at: "2026-10-08T14:15:00Z" });
  assert.strictEqual(pasoDePregunta({ pregunta: ya, ciclo: CICLO, ahora: t("2026-10-08T14:40:00Z") }).accion, "nada");
});

test("a la hora rota al siguiente, y del último vuelve al primero", () => {
  const r = pasoDePregunta({ pregunta: p(), ciclo: CICLO, ahora: t("2026-10-08T15:00:00Z") });
  assert.deepStrictEqual([r.accion, r.nuevo.id], ["rotar", "a2"]);
  const r3 = pasoDePregunta({ pregunta: p({ asesor_id: "a3" }), ciclo: CICLO, ahora: t("2026-10-08T15:00:00Z") });
  assert.strictEqual(r3.nuevo.id, "a1");
});

test("con un solo asesor, a la hora se le vuelve a asignar a él", () => {
  const r = pasoDePregunta({ pregunta: p(), ciclo: [A1], ahora: t("2026-10-08T15:00:00Z") });
  assert.deepStrictEqual([r.accion, r.nuevo.id], ["rotar", "a1"]);
});

test("sin asesor asignado, se asigna al primero del ciclo", () => {
  const r = pasoDePregunta({ pregunta: p({ asesor_id: null }), ciclo: CICLO, ahora: t("2026-10-08T14:01:00Z") });
  assert.deepStrictEqual([r.accion, r.nuevo.id], ["asignar", "a1"]);
});

test("si su asesor ya no está en el ciclo, rota al primero", () => {
  const r = pasoDePregunta({ pregunta: p({ asesor_id: "zz" }), ciclo: CICLO, ahora: t("2026-10-08T15:00:00Z") });
  assert.strictEqual(r.nuevo.id, "a1");
});

test("de noche y en domingo no pasa nada", () => {
  assert.strictEqual(pasoDePregunta({ pregunta: p(), ciclo: CICLO, ahora: t("2026-10-09T03:00:00Z") }).accion, "nada");
  // Domingo 2026-10-11, 10:00 a. m. Bogota.
  assert.strictEqual(pasoDePregunta({ pregunta: p({ asignada_at: "2026-10-10T20:00:00Z" }), ciclo: CICLO, ahora: t("2026-10-11T15:00:00Z") }).accion, "nada");
});

test("sin ciclo o pregunta cerrada, nada", () => {
  assert.strictEqual(pasoDePregunta({ pregunta: p(), ciclo: [], ahora: t("2026-10-08T15:00:00Z") }).accion, "nada");
  assert.strictEqual(pasoDePregunta({ pregunta: p({ estado: "respondida" }), ciclo: CICLO, ahora: t("2026-10-08T15:00:00Z") }).accion, "nada");
});

// Caso 2026-10-29: 48 avisos por una sola pregunta en 3 dias.
test("con el tope de avisos enviados la escalera calla", () => {
  const w = (n) => Array.from({ length: n }, (_, i) => `w${i}`);
  const llena = p({ wamids_aviso: w(6) });
  assert.strictEqual(pasoDePregunta({ pregunta: llena, ciclo: CICLO, ahora: t("2026-10-08T15:00:00Z") }).accion, "nada");
  assert.strictEqual(pasoDePregunta({ pregunta: p({ wamids_aviso: w(48) }), ciclo: CICLO, ahora: t("2026-10-08T14:15:00Z") }).accion, "nada");
});

test("el aviso que completa el tope sale marcado como ultimo", () => {
  const w = (n) => Array.from({ length: n }, (_, i) => `w${i}`);
  const r = pasoDePregunta({ pregunta: p({ wamids_aviso: w(5) }), ciclo: CICLO, ahora: t("2026-10-08T15:00:00Z") });
  assert.deepStrictEqual([r.accion, r.ultimo], ["rotar", true]);
  const antes = pasoDePregunta({ pregunta: p({ wamids_aviso: w(2) }), ciclo: CICLO, ahora: t("2026-10-08T14:15:00Z") });
  assert.deepStrictEqual([antes.accion, antes.ultimo], ["reaviso", false]);
});

test("si la asignada ya no está en el turno (ventana cerrada), pasa a la primera", () => {
  const r = pasoDePregunta({ pregunta: p({ asesor_id: "a3" }), ciclo: [A1], ahora: t("2026-10-08T14:20:00Z") });
  assert.deepStrictEqual([r.accion, r.nuevo.id], ["asignar", "a1"]);
});

test("el tope usa los avisos que contaron, no los que WhatsApp rechazó", () => {
  const w = Array.from({ length: 10 }, (_, i) => `w${i}`);
  const r = pasoDePregunta({ pregunta: p({ wamids_aviso: w }), ciclo: CICLO, ahora: t("2026-10-08T15:00:00Z"), enviados: 4 });
  assert.deepStrictEqual([r.accion, r.ultimo], ["rotar", false]);
});
