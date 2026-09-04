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
  assert.deepStrictEqual(c, { usados: 240, total: 300, fraccion: 0.8 });
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
