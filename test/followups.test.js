const { test } = require("node:test");
const assert = require("node:assert");
const { inQuietHours, hourInBogota, buildFollowupSystemPrompt } = require("../src/scheduler/followups");

const CFG = { quietStartHour: 20, quietEndHour: 8 };

test("inQuietHours: silencio de 8pm a 8am (no molestar al cliente de noche)", () => {
  for (const h of [20, 21, 23, 0, 3, 7]) {
    assert.equal(inQuietHours(h, CFG), true, `hora ${h} deberia ser silencio`);
  }
});

test("inQuietHours: horario habil 8am-8pm (se permite el seguimiento)", () => {
  for (const h of [8, 10, 12, 15, 19]) {
    assert.equal(inQuietHours(h, CFG), false, `hora ${h} deberia ser habil`);
  }
});

test("hourInBogota devuelve una hora valida 0-23", () => {
  const h = hourInBogota(new Date("2026-07-23T15:30:00Z")); // 10:30 am en Bogota
  assert.equal(h, 10);
});

test("buildFollowupSystemPrompt usa el nombre de la org, no Diamond/Medellin hardcodeado", () => {
  const prompt = buildFollowupSystemPrompt({ name: "Otra Inmobiliaria" });
  assert.match(prompt, /Otra Inmobiliaria/);
  assert.doesNotMatch(prompt, /Medellin/i);
  assert.doesNotMatch(prompt, /Diamond/i);
});

test("buildFollowupSystemPrompt sin org cae a un texto generico", () => {
  const prompt = buildFollowupSystemPrompt(null);
  assert.match(prompt, /la inmobiliaria/);
});

// BUG (2026-10-17): una plantilla NO abre la ventana de 24 h; solo la abre un
// mensaje del cliente. Tras retomar 9 chats con la plantilla retomar_cliente,
// la Fase 1 iba a mandarles texto libre una hora despues: Meta lo rechaza
// (131047) y el lead quedaba marcado como "seguimiento hecho".
const { ventanaAbierta } = require("../src/scheduler/followups");

test("ventanaAbierta: el cliente escribio hace 3 horas -> abierta", () => {
  const ahora = new Date("2026-10-17T16:00:00Z");
  assert.strictEqual(ventanaAbierta("2026-10-17T13:00:00Z", ahora), true);
});

test("ventanaAbierta: el ultimo mensaje del cliente es de hace dias -> cerrada", () => {
  const ahora = new Date("2026-10-17T16:00:00Z");
  assert.strictEqual(ventanaAbierta("2026-10-10T14:00:00Z", ahora), false);
});

test("ventanaAbierta: si el cliente nunca escribio -> cerrada", () => {
  assert.strictEqual(ventanaAbierta(null, new Date()), false);
});
