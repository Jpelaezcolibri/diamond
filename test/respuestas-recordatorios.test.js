// test/respuestas-recordatorios.test.js
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const rec = require("../src/scheduler/respuestas-publicacion");

const H = 3600e3;
const LUNES_10AM = new Date("2026-10-19T15:00:00Z");
const fila = (horas, extra = {}) => ({
  id: "r1", property_ref: "10505566", via: "linea", colega_lid: "1@lid", colega_nombre: "Laura Gómez",
  primer_at: new Date(LUNES_10AM - horas * H).toISOString(), ultimo_entrante_at: new Date(LUNES_10AM - horas * H).toISOString(),
  atendida_at: null, recordatorio_at: null, puente_at: null, seguimiento_at: null, ...extra,
});

beforeEach(() => { process.env.RADAR_RESPUESTAS_POST = "true"; });

test("decidir: 2 h -> daiana; 3 h -> puente; atendida y 24 h de silencio -> seguimiento", () => {
  assert.strictEqual(rec.decidir(fila(1), LUNES_10AM), null);
  assert.strictEqual(rec.decidir(fila(2.1), LUNES_10AM), "daiana");
  assert.strictEqual(rec.decidir(fila(3.1, { recordatorio_at: "x" }), LUNES_10AM), "puente");
  assert.strictEqual(rec.decidir(fila(25, { recordatorio_at: "x", puente_at: "x" }), LUNES_10AM), "seguimiento");
  assert.strictEqual(rec.decidir(fila(30, { recordatorio_at: "x", puente_at: "x", seguimiento_at: "x" }), LUNES_10AM), null);
});

test("textos exactos", () => {
  assert.strictEqual(rec.textoPuente(fila(3), "L"), "Hola Laura, gracias por escribir por la Ref 10505566 🙌 Para responderte ya y agendar la visita, te atiende Sofi aquí: L");
  assert.strictEqual(rec.textoSeguimiento(fila(3, { colega_nombre: "🏠" }), "L"), "Hola, ¿tu cliente alcanzó a ver la Ref 10505566? Si quiere visitarla, la agendamos con Sofi: L");
});

function deps(over = {}) {
  const log = { notif: [], dms: [], marcas: [] };
  return {
    log,
    d: {
      orgs: async () => [{ id: "org-1", name: "Diamond" }],
      abiertas: async () => [fila(3.1, { recordatorio_at: "x" })],
      asesora: async () => ({ id: "adv-1", name: "Daiana" }),
      sesion: async () => "DaianaDiamond",
      cuota: async () => ({ fraccion: 0.2 }),
      enviadosHoy: async () => 0,
      puenteReciente: async () => false,
      notificar: async (n) => { log.notif.push(n); return { ok: true }; },
      enviarDm: async (s, tel, texto, opts) => { log.dms.push({ texto, opts }); return { ok: true, wamid: "w" }; },
      marcar: async (id, patch) => log.marcas.push(patch),
      link: () => "L",
      ...over,
    },
  };
}

test("manda el link a Sofi por la linea al lid del colega y marca puente_at", async () => {
  const { d, log } = deps();
  await rec.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.strictEqual(log.dms.length, 1);
  assert.deepStrictEqual(log.dms[0].opts, { lid: "1@lid", orgId: "org-1" });
  assert.ok(log.marcas[0].puente_at);
});

test("recordatorio a Daiana por la campana", async () => {
  const { d, log } = deps({ abiertas: async () => [fila(2.5)] });
  await rec.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.strictEqual(log.notif[0].tipo, "respuesta_sin_atender");
  assert.strictEqual(log.notif[0].link, "/publicaciones");
  assert.ok(log.marcas[0].recordatorio_at);
  assert.strictEqual(log.dms.length, 0);
});

test("frenos: domingo, fuera de hora, tope, cuota, puente reciente, interruptor", async () => {
  for (const [ahora, over] of [
    [new Date("2026-10-18T15:00:00Z"), {}],                 // domingo
    [new Date("2026-10-20T01:00:00Z"), {}],                 // 8 p. m.
    [LUNES_10AM, { enviadosHoy: async () => 20 }],
    [LUNES_10AM, { cuota: async () => ({ fraccion: 0.85 }) }],
    [LUNES_10AM, { puenteReciente: async () => true }],
  ]) {
    const { d, log } = deps(over);
    await rec.runOnce({ ahora, deps: d });
    assert.strictEqual(log.dms.length, 0, JSON.stringify(over));
  }
  process.env.RADAR_RESPUESTAS_POST = "false";
  const { d, log } = deps();
  await rec.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.strictEqual(log.dms.length + log.notif.length, 0);
});

test("solo llamada: la fila queda marcada para no insistir", async () => {
  const { d, log } = deps({ enviarDm: async () => ({ ok: false, error: "colega_solo_llamada", previoAlEnvio: false }) });
  await rec.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.strictEqual(log.marcas.length, 1);
  assert.ok(log.marcas[0].puente_at, "solo llamada se marca para no insistir");
});

test("un fallo de envio no se reintenta: la fila ya quedo reclamada", async () => {
  for (const r of [{ ok: false, error: "timeout", previoAlEnvio: false }, { ok: false, error: "red", previoAlEnvio: true }]) {
    const { d, log } = deps({ enviarDm: async () => r });
    await rec.runOnce({ ahora: LUNES_10AM, deps: d });
    assert.strictEqual(log.marcas.length, 1);
    assert.ok(log.marcas[0].puente_at);
  }
  const { d, log } = deps({ enviarDm: async () => { throw new Error("boom"); } });
  await rec.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.ok(log.marcas[0].puente_at);
});

test("se reclama antes de enviar", async () => {
  const orden = [];
  const { d } = deps({ marcar: async () => orden.push("marcar"), enviarDm: async () => { orden.push("enviar"); return { ok: true }; } });
  await rec.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.deepStrictEqual(orden, ["marcar", "enviar"]);
});

test("Daiana: si notificar falla no se marca; sin asesora corre la regla del colega", async () => {
  let { d, log } = deps({ abiertas: async () => [fila(2.5)], notificar: async () => ({ ok: false }) });
  await rec.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.strictEqual(log.marcas.length, 0);
  ({ d, log } = deps({ abiertas: async () => [fila(3.5)], asesora: async () => null }));
  await rec.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.strictEqual(log.notif.length, 0);
  assert.strictEqual(log.dms.length, 1);
  assert.ok(log.marcas[0].puente_at);
});

test("sin link no se envia ni se reclama", async () => {
  const { d, log } = deps({ link: () => null });
  await rec.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.strictEqual(log.dms.length, 0);
  assert.strictEqual(log.marcas.length, 0);
});

test("fila tardia: daiana, luego puente, y seguimiento solo 24 h despues del puente", () => {
  let f = fila(30);
  assert.strictEqual(rec.decidir(f, LUNES_10AM), "daiana");
  f = { ...f, recordatorio_at: "-" };
  assert.strictEqual(rec.decidir(f, LUNES_10AM), "puente");
  const puente = (h) => ({ ...f, puente_at: new Date(LUNES_10AM - h * H).toISOString() });
  assert.strictEqual(rec.decidir(puente(0.25), LUNES_10AM), null);
  assert.strictEqual(rec.decidir(puente(23), LUNES_10AM), null);
  assert.strictEqual(rec.decidir(puente(24.1), LUNES_10AM), "seguimiento");
});

test("atendida hace 2 h: sin seguimiento aunque su ultimo mensaje sea de hace 25 h", () => {
  const f = fila(25, { atendida_at: new Date(LUNES_10AM - 2 * H).toISOString() });
  assert.strictEqual(rec.decidir(f, LUNES_10AM), null);
});

test("ventanas: daiana y puente solo si primer_at tiene menos de 48 h", () => {
  assert.strictEqual(rec.decidir(fila(47), LUNES_10AM), "daiana");
  assert.strictEqual(rec.decidir(fila(49), LUNES_10AM), null);
  assert.strictEqual(rec.decidir(fila(49, { recordatorio_at: "x" }), LUNES_10AM), null); // ni puente
  assert.strictEqual(rec.decidir(fila(47, { recordatorio_at: "x" }), LUNES_10AM), "puente");
});

test("ventanas: seguimiento solo entre 24 h y 7 dias de su referencia", () => {
  const at = (h) => new Date(LUNES_10AM - h * H).toISOString();
  const f = (h) => fila(h + 100, { atendida_at: at(h), ultimo_entrante_at: at(h + 1) });
  assert.strictEqual(rec.decidir(f(23), LUNES_10AM), null);
  assert.strictEqual(rec.decidir(f(25), LUNES_10AM), "seguimiento");
  assert.strictEqual(rec.decidir(f(24 * 6), LUNES_10AM), "seguimiento");
  assert.strictEqual(rec.decidir(f(24 * 8), LUNES_10AM), null);
});

test("tope: a Daiana se le avisan 10 por tick y por org", async () => {
  const filas = Array.from({ length: 15 }, (_, i) => fila(2.5, { id: "r" + i }));
  const { d, log } = deps({ abiertas: async () => filas });
  await rec.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.strictEqual(log.notif.length, 10);
  assert.strictEqual(log.marcas.length, 10);
});

test("sinAtender: consulta la ventana 2-48 h y devuelve total real con 20 filas", async () => {
  const sbPath = require.resolve("../src/data/supabase");
  const previo = require.cache[sbPath];
  const q = { filtros: [] };
  const cad = {
    select(_c, o) { q.opts = o; return cad; },
    eq() { return cad; }, in() { return cad; }, is() { return cad; },
    lte(c, v) { q.filtros.push(["lte", c, v]); return cad; },
    gte(c, v) { q.filtros.push(["gte", c, v]); return cad; },
    order() { return cad; },
    limit() { return Promise.resolve({ data: [{ property_ref: "1" }], count: 33, error: null }); },
  };
  require.cache[sbPath] = { id: sbPath, filename: sbPath, loaded: true, exports: { from: () => cad } };
  try {
    const r = await rec.sinAtender("org-1", LUNES_10AM);
    assert.strictEqual(r.total, 33);
    assert.strictEqual(r.filas.length, 1);
    assert.deepStrictEqual(q.opts, { count: "exact" });
    assert.deepStrictEqual(q.filtros, [["lte", "primer_at", new Date(LUNES_10AM - 2 * H).toISOString()], ["gte", "primer_at", new Date(LUNES_10AM - 48 * H).toISOString()]]);
  } finally {
    if (previo) require.cache[sbPath] = previo; else delete require.cache[sbPath];
  }
});
