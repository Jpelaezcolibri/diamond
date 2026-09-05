// El vigilante tiene que gritar cuando el radar empieza a disparar avisos.
//
// EL INCIDENTE (1 al 5 de septiembre de 2026). Salieron 1.906 avisos de
// oferta a UNA sola asesora —248, 664, 503, 362 y 129 por dia— y nada aviso.
// Peor: el interruptor del carril de compra estaba en `false` todo ese
// tiempo, el CRM mostraba "el carril de compra esta apagado", y el WhatsApp
// no paraba. Juan lo descubrio abriendo el telefono, igual que el baneo de
// julio y los 16 dias de DMAP detenido.
//
// Juan, 2026-09-05: "necesito que blindes esto para que no vuelva a pasar, si
// pasa que se alerte al asesor".
//
// Los arreglos de causa (el parser de presupuestos, el interruptor que ahora
// si apaga el carril entero) evitan ESTE fallo. Este chequeo es la red: avisa
// del SINTOMA —volumen anormal— sin importar que bug nuevo lo produzca.
const { test } = require("node:test");
const assert = require("node:assert");
const salud = require("../src/data/salud");

const { problemaDeVolumen, UMBRAL_AVISOS_DIA } = salud;

test("carril apagado y aun asi salieron avisos: la contradiccion se grita", () => {
  const p = problemaDeVolumen({ avisos: 129, carrilApagado: true });
  assert.ok(p, "no detecto la contradiccion");
  assert.strictEqual(p.clave, "avisos-carril-apagado");
  assert.match(p.texto, /129/);
  assert.match(p.texto, /APAGADO/i);
});

test("un solo aviso con el carril apagado ya es una contradiccion", () => {
  // No hay umbral aca a proposito: apagado significa cero. Uno solo ya
  // demuestra que el interruptor no manda, que es exactamente lo que paso.
  const p = problemaDeVolumen({ avisos: 1, carrilApagado: true });
  assert.ok(p);
  assert.strictEqual(p.clave, "avisos-carril-apagado");
});

test("carril apagado y cero avisos: todo bien, no molesta", () => {
  assert.strictEqual(problemaDeVolumen({ avisos: 0, carrilApagado: true }), null);
});

test("carril prendido con volumen normal: no molesta", () => {
  assert.strictEqual(problemaDeVolumen({ avisos: 5, carrilApagado: false }), null);
  assert.strictEqual(problemaDeVolumen({ avisos: UMBRAL_AVISOS_DIA - 1, carrilApagado: false }), null);
});

test("carril prendido pero disparando: avisa por volumen", () => {
  const p = problemaDeVolumen({ avisos: UMBRAL_AVISOS_DIA, carrilApagado: false });
  assert.ok(p, "no detecto el volumen anormal");
  assert.strictEqual(p.clave, "avisos-volumen");
  assert.match(p.texto, new RegExp(String(UMBRAL_AVISOS_DIA)));
});

test("el dia peor del incidente habria disparado la alarma con el carril prendido", () => {
  const p = problemaDeVolumen({ avisos: 664, carrilApagado: false });
  assert.ok(p);
  assert.match(p.texto, /664/);
});

test("el texto dice que hacer, no solo que pasa", () => {
  const p = problemaDeVolumen({ avisos: 664, carrilApagado: true });
  assert.match(p.texto, /Grupos|CRM|carril/i);
});

test("el umbral es un numero razonable, no un accidente", () => {
  assert.ok(UMBRAL_AVISOS_DIA >= 10 && UMBRAL_AVISOS_DIA <= 100, `umbral raro: ${UMBRAL_AVISOS_DIA}`);
});

test("sin supabase el contador no revienta ni inventa", async () => {
  const n = await salud.avisosDeOfertaRecientes("org-1", { ahora: new Date() });
  assert.strictEqual(typeof n, "number");
  assert.strictEqual(n, 0);
});
