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

test("un envio que falla (solo llamada) no marca y no reintenta en el mismo tick", async () => {
  const { d, log } = deps({ enviarDm: async () => ({ ok: false, error: "colega_solo_llamada", previoAlEnvio: false }) });
  await rec.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.strictEqual(log.marcas.length, 1);
  assert.ok(log.marcas[0].puente_at, "solo llamada se marca para no insistir");
});
