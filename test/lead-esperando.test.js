const test = require("node:test");
const assert = require("node:assert/strict");
const le = require("../src/scheduler/lead-esperando");

// 2026-10-21 15:00 Bogota = 20:00 UTC (miercoles)
const AHORA = new Date("2026-10-21T20:00:00Z");
const hace = (min) => new Date(AHORA.getTime() - min * 60000).toISOString();
const org = { id: "o1", name: "Diamond" };

function cand(id, modo, ultimo, lead = {}) {
  return { id, modo, lead: { id: "l" + id, phone: "57300" + id, source: "ads", seguimiento: {}, ...lead }, ultimo };
}
function mk(cands, extra = {}) {
  const calls = { alertas: [], notifs: [], marcas: [] };
  return {
    calls,
    deps: {
      orgs: async () => [org],
      candidatos: extra.candidatos || (async () => cands),
      alertar: async (r) => { calls.alertas.push(r); return extra.alertaOk !== false; },
      asesorDuenio: async () => ({ id: "a1", name: "Daiana" }),
      notificar: async (a) => { calls.notifs.push(a); return { ok: true }; },
      marcar: async (lead, id) => { calls.marcas.push([lead.id, id]); },
    },
  };
}
const u = (id, min, content = "Hola, me interesa") => ({ id, role: "user", content, created_at: hace(min) });

test.beforeEach(() => { le._reset(); delete process.env.SOFI_ALERTA_ESPERA; });

test("modo bot: una alerta agregada y no se repite en el episodio", async () => {
  const { deps, calls } = mk([cand("1", "bot", u("m1", 20)), cand("2", null, u("m2", 30))]);
  await le.runOnce({ ahora: AHORA, deps });
  await le.runOnce({ ahora: AHORA, deps });
  assert.equal(calls.alertas.length, 1);
  assert.match(calls.alertas[0], /2 clientes/);
});

test("modo bot: si ya nadie espera, el episodio termina y una nueva falla alerta de nuevo", async () => {
  let lista = [cand("1", "bot", u("m1", 20))];
  const { deps, calls } = mk(null, { candidatos: async () => lista });
  await le.runOnce({ ahora: AHORA, deps });
  lista = [];
  await le.runOnce({ ahora: AHORA, deps });
  lista = [cand("1", "bot", u("m3", 20))];
  await le.runOnce({ ahora: AHORA, deps });
  assert.equal(calls.alertas.length, 2);
});

test("modo bot: si la alerta no salio se reintenta", async () => {
  const { deps, calls } = mk([cand("1", "bot", u("m1", 20))], { alertaOk: false });
  await le.runOnce({ ahora: AHORA, deps });
  await le.runOnce({ ahora: AHORA, deps });
  assert.equal(calls.alertas.length, 2);
});

test("modo humano: notifica a la asesora una vez por mensaje", async () => {
  const c = cand("1", "humano", u("m1", 20));
  const { deps, calls } = mk([c]);
  await le.runOnce({ ahora: AHORA, deps });
  assert.equal(calls.notifs.length, 1);
  assert.equal(calls.notifs[0].tipo, "cliente_esperando");
  assert.equal(calls.notifs[0].link, "/inbox/1");
  assert.deepEqual(calls.marcas, [["l1", "m1"]]);
  assert.equal(calls.alertas.length, 0);
  c.lead.seguimiento = { espera_alertada_msg_id: "m1" };
  await le.runOnce({ ahora: AHORA, deps });
  assert.equal(calls.notifs.length, 1);
});

test("no cuenta: menos de 15 min, ultimo de Sofi, source asesor, ok/gracias", async () => {
  const { deps, calls } = mk([
    cand("1", "bot", u("a", 10)),
    cand("2", "bot", { id: "b", role: "assistant", content: "Hola", created_at: hace(60) }),
    cand("3", "bot", u("c", 60), { source: "asesor" }),
    cand("4", "bot", u("d", 60, "Ok gracias 👍")),
  ]);
  await le.runOnce({ ahora: AHORA, deps });
  assert.equal(calls.alertas.length, 0);
  assert.equal(le.esperaRespuesta("Cuánto cuesta?"), true);
  assert.equal(le.esperaRespuesta("[Nota de voz recibida]"), true);
});

test("fuera de horario no hace nada", async () => {
  const { deps, calls } = mk([cand("1", "bot", u("m1", 20))]);
  await le.runOnce({ ahora: new Date("2026-10-22T03:00:00Z"), deps }); // 10 p. m. Bogota
  assert.equal(calls.alertas.length, 0);
});

test("falla de consulta: no alerta", async () => {
  const { deps, calls } = mk(null, { candidatos: async () => { throw new Error("db"); } });
  await le.runOnce({ ahora: AHORA, deps });
  assert.equal(calls.alertas.length, 0);
});

test("interruptor apaga", async () => {
  process.env.SOFI_ALERTA_ESPERA = "false";
  const { deps, calls } = mk([cand("1", "bot", u("m1", 20))]);
  await le.runOnce({ ahora: AHORA, deps });
  assert.equal(calls.alertas.length, 0);
});

test("modo humano sin duena: cae a la asesora principal; sin ella, no avisa", async () => {
  const c = cand("1", "humano", u("m1", 20));
  const { deps, calls } = mk([c]);
  deps.asesorDuenio = async () => null;
  deps.asesorPrincipal = async () => ({ id: "p1", name: "Principal" });
  await le.runOnce({ ahora: AHORA, deps });
  assert.equal(calls.notifs.length, 1);
  assert.equal(calls.notifs[0].advisor.id, "p1");
  assert.deepEqual(calls.marcas, [["l1", "m1"]]);
  const b = mk([cand("2", "humano", u("m2", 20))]);
  b.deps.asesorDuenio = async () => null;
  b.deps.asesorPrincipal = async () => null;
  await le.runOnce({ ahora: AHORA, deps: b.deps });
  assert.equal(b.calls.notifs.length, 0);
  assert.equal(b.calls.marcas.length, 0);
});

test("leads descartado/cerrados no cuentan", async () => {
  const { deps, calls } = mk(["descartado", "cerrado_ganado", "cerrado_perdido"].map((e, i) => cand(String(i), "bot", u("m" + i, 20), { estado: e })));
  await le.runOnce({ ahora: AHORA, deps });
  assert.equal(calls.alertas.length, 0);
});

test("mensajes de mas de 12 h no cuentan; de 11 h si", async () => {
  const viejo = cand("1", "bot", u("m1", 13 * 60));
  assert.equal(le.estaEsperando(viejo, AHORA), false);
  assert.equal(le.estaEsperando(cand("2", "bot", u("m2", 11 * 60)), AHORA), true);
});

test("el texto trae la edad real", async () => {
  assert.equal(le.textoEdad(130 * 60000), "2 h 10 min");
  assert.equal(le.textoEdad(20 * 60000), "20 min");
  const { deps, calls } = mk([cand("1", "humano", u("m1", 130)), cand("2", "bot", u("m2", 130))]);
  await le.runOnce({ ahora: AHORA, deps });
  assert.match(calls.notifs[0].titulo, /2 h 10 min sin respuesta/);
  assert.match(calls.alertas[0], /2 h 10 min/);
});

test("de noche: un solo resumen por asesora al abrir el horario", async () => {
  // 8:03 a. m. Bogota = 13:03 UTC; mensajes de las 10 p. m. y 11 p. m. (03:00 y 04:00 UTC)
  const manana = new Date("2026-10-22T13:03:00Z");
  const m = (id, iso) => ({ id, role: "user", content: "Hola", created_at: iso });
  const { deps, calls } = mk([
    cand("1", "humano", m("n1", "2026-10-22T03:00:00Z")),
    cand("2", "humano", m("n2", "2026-10-22T04:00:00Z")),
    cand("3", "humano", m("d1", "2026-10-22T12:30:00Z")), // 7:30 a. m., tambien fuera de horario
  ]);
  await le.runOnce({ ahora: manana, deps });
  assert.equal(calls.notifs.length, 1);
  assert.match(calls.notifs[0].titulo, /^3 clientes escribieron fuera de horario/);
  assert.equal(calls.marcas.length, 3);
});

test("cargarCandidatos parte los ids en trozos de 100", async () => {
  const ids = Array.from({ length: 250 }, (_, i) => "c" + i);
  const tamanos = [];
  const fake = {
    from(t) {
      const q = {
        select() { return q; }, eq() { return q; }, gte() { return q; }, order() { return q; },
        in(col, vals) { if (col === "conversation_id") tamanos.push(vals.length); return q; },
        limit() {
          if (t === "conversations") return Promise.resolve({ data: ids.map((id) => ({ id, modo: "bot", leads: {} })), error: null });
          return Promise.resolve({ data: [], error: null });
        },
      };
      return q;
    },
  };
  const key = require.resolve("../src/data/supabase");
  const previo = require.cache[key];
  require.cache[key] = { id: key, filename: key, loaded: true, exports: fake };
  try {
    const r = await le.cargarCandidatos(org, AHORA);
    assert.equal(r.length, 250);
    assert.deepEqual(tamanos, [100, 100, 50]);
  } finally {
    if (previo) require.cache[key] = previo; else delete require.cache[key];
  }
});
