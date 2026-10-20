const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const vigencia = require("../src/scheduler/vigencia-asesor");
const boton = require("../src/lib/vigencia-asesor");
const datos = require("../src/data/propiedades-asesor");
const advisors = require("../src/data/advisors");
const mensajeAsesor = require("../src/lib/mensaje-asesor");

const ORG = { id: "org-1", name: "Diamond" };
const ADV = { id: "adv-1", name: "Daiana", phone: "573011880668" };
const LUNES_10AM = new Date("2026-10-19T15:00:00Z");

function deps(over = {}) {
  const log = { notis: [], preguntadas: [], bajas: [] };
  return {
    log,
    d: {
      orgs: async () => [ORG],
      porPreguntar: async () => [],
      vencidas: async () => [],
      advisor: async () => ADV,
      notificar: async (n) => { log.notis.push(n); return { ok: true, push: 0 }; },
      marcarPreguntada: async (id) => log.preguntadas.push(id),
      darDeBaja: async (id) => log.bajas.push(id),
      ...over,
    },
  };
}

beforeEach(() => { delete process.env.SOFI_VIGENCIA_ASESOR; });

test("la pregunta va por la campana del CRM, sin WhatsApp ni plantilla", async () => {
  const { d, log } = deps({ porPreguntar: async () => [{ id: "p1", ref: "D1001", titulo: "Casa en venta en Belén", captador_id: "adv-1" }] });
  await vigencia.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.deepEqual(log.notis, [{
    orgId: "org-1", advisor: ADV, tipo: "vigencia_propiedad", titulo: "D1001 vence en 5 días",
    cuerpo: "¿Sigue disponible? Respondé en Para atender.", link: "/pendientes",
  }]);
  assert.deepEqual(log.preguntadas, ["p1"]);
});

test("si notificar falla igual se marca preguntada", async (t) => {
  t.mock.method(console, "warn", () => {});
  const { d, log } = deps({
    porPreguntar: async () => [{ id: "p1", ref: "D1001", captador_id: "adv-1" }],
    notificar: async () => { throw new Error("caido"); },
  });
  await vigencia.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.deepEqual(log.preguntadas, ["p1"]);
});

test("vencida: sale del inventario aunque la pregunta este apagada", async () => {
  process.env.SOFI_VIGENCIA_ASESOR = "false";
  const { d, log } = deps({
    porPreguntar: async () => [{ id: "p1", ref: "D1001", captador_id: "adv-1" }],
    vencidas: async () => [{ id: "p2", ref: "D1002", captador_id: "adv-1" }],
  });
  await vigencia.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.deepEqual(log.bajas, ["p2"]);
  assert.equal(log.preguntadas.length, 0);
});

test("fuera de 9 a. m. a 6 p. m. no pregunta", async () => {
  const { d, log } = deps({ porPreguntar: async () => [{ id: "p1", ref: "D1001", captador_id: "adv-1" }] });
  await vigencia.runOnce({ ahora: new Date("2026-10-19T12:00:00Z"), deps: d }); // 7 a. m.
  assert.equal(log.notis.length, 0);
});

test("boton vig:no da de baja la del asesor y le confirma", async (t) => {
  t.mock.method(advisors, "findByPhone", async () => ADV);
  const aplicar = t.mock.method(datos, "aplicarVigencia", async () => ({ estado: "baja", ref: "D1001" }));
  const envios = [];
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async (org, tel, texto) => { envios.push(texto); return { ok: true }; });
  await boton.procesarBotonVigencia(ORG, ADV.phone, "vig:no:D1001");
  assert.deepEqual(aplicar.mock.calls[0].arguments, ["org-1", "adv-1", "D1001", false]);
  assert.match(envios[0], /sale del inventario/);
});

test("I6: sin la migracion avisa una vez al dia con warn y nunca con error", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const err = t.mock.method(console, "error", () => {});
  const falla = async () => { const e = new Error("column properties.vence_at does not exist"); e.code = "42703"; throw e; };
  const { d } = deps({ vencidas: falla });
  vigencia._reset();
  await vigencia.runOnce({ ahora: LUNES_10AM, deps: d });
  await vigencia.runOnce({ ahora: new Date(LUNES_10AM.getTime() + 3600e3), deps: d });
  assert.equal(warn.mock.callCount(), 1);
  assert.equal(err.mock.callCount(), 0);
  await vigencia.runOnce({ ahora: new Date(LUNES_10AM.getTime() + 25 * 3600e3), deps: d });
  assert.equal(warn.mock.callCount(), 2);
  // Un error distinto sigue siendo error.
  const { d: d2 } = deps({ vencidas: async () => { throw new Error("otro"); } });
  await vigencia.runOnce({ ahora: LUNES_10AM, deps: d2 });
  assert.equal(err.mock.callCount(), 1);
});

test("M9: al vencer avisa al captador; si falla solo se registra", async (t) => {
  t.mock.method(console, "warn", () => {});
  const { d, log } = deps({ vencidas: async () => [{ id: "p2", ref: "D1002", captador_id: "adv-1" }] });
  await vigencia.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.deepEqual(log.bajas, ["p2"]);
  assert.deepEqual(log.notis, [{
    orgId: "org-1", advisor: ADV, tipo: "vigencia_vencida", titulo: "D1002 salió del inventario",
    cuerpo: "Venció a los 30 días. Si sigue disponible, pedile a Sofi que la publique de nuevo.", link: "/pendientes",
  }]);
  const { d: d2, log: log2 } = deps({
    vencidas: async () => [{ id: "p3", ref: "D1003", captador_id: "adv-1" }],
    notificar: async () => { throw new Error("caido"); },
  });
  await vigencia.runOnce({ ahora: LUNES_10AM, deps: d2 });
  assert.deepEqual(log2.bajas, ["p3"]);
});

test("el aviso de vencimiento solo sale de 9 a. m. a 6 p. m.; la baja siempre", async () => {
  const noche = new Date("2026-10-20T03:00:00Z"); // 10 p. m. en Bogota
  const { d, log } = deps({ vencidas: async () => [{ id: "p2", ref: "D1002", captador_id: "adv-1" }] });
  await vigencia.runOnce({ ahora: noche, deps: d });
  assert.deepEqual(log.bajas, ["p2"]);
  assert.equal(log.notis.length, 0);
});
