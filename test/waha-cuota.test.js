// LA CUOTA QUE NO PONEMOS NOSOTROS (2026-09-04). WhatsApp le impone a la linea
// un tope propio, visible en la sesion de WAHA:
//   "messageCapping": {"totalQuota":300,"usedQuota":12,
//                      "cycleStart":2026-09-01,"cycleEnd":2026-10-01}
// 300 por mes calendario. Con ~17 pedidos/dia, abrir la manguera sin freno
// agota la cuota cerca del dia 18 y deja el radar mudo el resto del mes.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const waha = require("../src/lib/waha");

let respuesta;
beforeEach(() => {
  process.env.WAHA_URL = "http://waha.test";
  process.env.WAHA_API_KEY = "k";
  globalThis.fetch = async () => ({
    ok: true, status: 200, text: async () => JSON.stringify(respuesta),
  });
});

test("lee usados, total y fraccion de messageCapping", async () => {
  respuesta = { name: "RADA-NATALIA", status: "WORKING", me: { messageCapping: { totalQuota: 300, usedQuota: 240 } } };
  const c = await waha.cuotaDeLinea("RADA-NATALIA");
  assert.deepStrictEqual(c, { usados: 240, total: 300, fraccion: 0.8, cycleStart: null, cycleEnd: null });
});

// EL CICLO ES PARTE DE LA MEDICION (revision final, 2026-09-04). 240/300 sin
// las fechas del ciclo no dice si se gastaron hoy o en tres semanas -- y eso es
// justo lo que hay que poder mirar en el endpoint de salud.
test("devuelve tambien el ciclo que reporta WhatsApp, sin reinterpretarlo", async () => {
  respuesta = {
    me: { messageCapping: { totalQuota: 300, usedQuota: 12, cycleStart: "2026-09-01", cycleEnd: "2026-10-01" } },
  };
  const c = await waha.cuotaDeLinea("RADA-NATALIA");
  assert.strictEqual(c.cycleStart, "2026-09-01");
  assert.strictEqual(c.cycleEnd, "2026-10-01");
});

// Sin el campo NO se inventa un numero: devolver 0 usados seria decirle al
// cortacircuitos que hay cuota de sobra cuando en realidad no sabemos.
test("sin messageCapping devuelve null, no un cero optimista", async () => {
  respuesta = { name: "RADA-NATALIA", status: "WORKING", me: {} };
  assert.strictEqual(await waha.cuotaDeLinea("RADA-NATALIA"), null);
});

test("con totalQuota en cero devuelve null y no divide por cero", async () => {
  respuesta = { me: { messageCapping: { totalQuota: 0, usedQuota: 0 } } };
  assert.strictEqual(await waha.cuotaDeLinea("RADA-NATALIA"), null);
});

// EL CERO OPTIMISTA QUE LA CABECERA DE cuotaDeLinea PROHIBE (revision final,
// 2026-09-04). `Number(cap.usedQuota) || 0` convierte undefined/null/"n/a" en
// 0, y ese 0 no dice "no sabemos": le dice al cortacircuitos que hay 300 de
// cuota libre. Si el uso real fuera 290/300 se sigue enviando hasta que
// WhatsApp corte la linea — la misma linea que ya fue baneada una vez
// (2026-07-30). Ademas la traza guardaria "cuota_wa:0/300", una afirmacion
// falsa en el registro de auditoria.
test("con totalQuota pero SIN usedQuota devuelve null, no un cero optimista", async () => {
  respuesta = { name: "RADA-NATALIA", status: "WORKING", me: { messageCapping: { totalQuota: 300 } } };
  assert.strictEqual(await waha.cuotaDeLinea("RADA-NATALIA"), null);
});

test("un usedQuota que no es un numero tampoco se lee como cero", async () => {
  respuesta = { me: { messageCapping: { totalQuota: 300, usedQuota: "n/a" } } };
  assert.strictEqual(await waha.cuotaDeLinea("RADA-NATALIA"), null);

  respuesta = { me: { messageCapping: { totalQuota: 300, usedQuota: null } } };
  assert.strictEqual(await waha.cuotaDeLinea("RADA-NATALIA"), null);
});

// Un cero REAL sigue siendo un cero: la linea que no mando nada en el ciclo.
test("usedQuota en cero explicito si es un cero legitimo", async () => {
  respuesta = { me: { messageCapping: { totalQuota: 300, usedQuota: 0 } } };
  const c = await waha.cuotaDeLinea("RADA-NATALIA");
  assert.strictEqual(c.usados, 0);
  assert.strictEqual(c.fraccion, 0);
});
