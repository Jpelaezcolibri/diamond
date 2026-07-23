const { test } = require("node:test");
const assert = require("node:assert");
const { inQuietHours, hourInBogota } = require("../src/scheduler/followups");

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
