const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const rc = require("../src/scheduler/radar-callado");

// Bogota = UTC-5. 2026-10-20 es martes.
const b = (iso) => new Date(iso + "-05:00");

beforeEach(() => rc._reset());

test("horasHabiles: mismo dia, cruza noche y domingo", () => {
  assert.equal(rc.horasHabiles(b("2026-10-20T09:00:00"), b("2026-10-20T13:00:00")), 4);
  // martes 18:00 -> miercoles 10:00 = 2 + 2
  assert.equal(rc.horasHabiles(b("2026-10-20T18:00:00"), b("2026-10-21T10:00:00")), 4);
  // sabado 19:00 -> lunes 9:00 = 1 + 1 (domingo no cuenta)
  assert.equal(rc.horasHabiles(b("2026-10-24T19:00:00"), b("2026-10-26T09:00:00")), 2);
  assert.equal(rc.horasHabiles(b("2026-10-25T09:00:00"), b("2026-10-25T18:00:00")), 0);
});

function fabrica(ultimaSenal, ultimaLinea = null) {
  const enviados = [];
  return {
    enviados,
    deps: {
      orgs: async () => [{ id: "o1" }],
      ultimaSenal: async () => ultimaSenal.v,
      ultimaLinea: async () => (ultimaLinea ? ultimaLinea.v : null),
      enviar: async (r) => { enviados.push(r); return true; },
    },
  };
}

test("una sola alerta por episodio y aviso al recuperarse", async () => {
  const s = { v: b("2026-10-20T08:00:00") };
  const f = fabrica(s);
  await rc.runOnce({ ahora: b("2026-10-20T12:00:00"), deps: f.deps }); // 4 h: nada
  assert.equal(f.enviados.length, 0);
  await rc.runOnce({ ahora: b("2026-10-20T15:00:00"), deps: f.deps }); // 7 h
  await rc.runOnce({ ahora: b("2026-10-20T15:30:00"), deps: f.deps });
  assert.equal(f.enviados.length, 1);
  assert.match(f.enviados[0], /El radar no recibe pedidos desde/);
  s.v = b("2026-10-20T15:40:00");
  await rc.runOnce({ ahora: b("2026-10-20T16:00:00"), deps: f.deps });
  assert.equal(f.enviados.length, 2);
  assert.match(f.enviados[1], /volvió a recibir pedidos/);
  await rc.runOnce({ ahora: b("2026-10-20T16:30:00"), deps: f.deps });
  assert.equal(f.enviados.length, 2);
});

test("fuera de horario o domingo no revisa; interruptor apaga", async () => {
  const f = fabrica({ v: b("2026-10-19T08:00:00") });
  await rc.runOnce({ ahora: b("2026-10-20T21:00:00"), deps: f.deps });
  await rc.runOnce({ ahora: b("2026-10-25T10:00:00"), deps: f.deps });
  assert.equal(f.enviados.length, 0);
  process.env.RADAR_CALLADO_ACTIVO = "false";
  try {
    await rc.runOnce({ ahora: b("2026-10-20T15:00:00"), deps: f.deps });
    assert.equal(f.enviados.length, 0);
  } finally {
    delete process.env.RADAR_CALLADO_ACTIVO;
  }
});

test("linea_dm: alerta a las 24 h habiles", async () => {
  const f = fabrica({ v: b("2026-10-20T14:50:00") }, { v: b("2026-10-17T10:00:00") });
  const r = await rc.runOnce({ ahora: b("2026-10-20T15:00:00"), deps: f.deps });
  assert.deepEqual(r.map((x) => x.canal), ["linea"]);
  assert.match(f.enviados[0], /línea de DM/);
});
