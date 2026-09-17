// ASESORA_SOLO_VISITAS=true: a la asesora solo le llegan citas y sus
// recordatorios; el radar calla avisos, seguimientos y alertas (Juan,
// 2026-09-17). Ver src/lib/solo-visitas.js.

const { test, afterEach } = require("node:test");
const assert = require("node:assert");

const soloVisitas = require("../src/lib/solo-visitas");
const organizations = require("../src/data/organizations");
const mensajeAsesor = require("../src/lib/mensaje-asesor");
const canalWhatsapp = require("../src/channels/whatsapp");
const silencio = require("../src/scheduler/radar-silencio");
const avisosSalida = require("../src/scheduler/avisos-salida");
const cierreDia = require("../src/scheduler/cierre-dia");
const digest = require("../src/scheduler/group-digest");
const recordatorio = require("../src/scheduler/radar-recordatorio");
const visitasVenta = require("../src/scheduler/visitas-venta");
const avisarMandato = require("../src/groups/avisar-mandato");

afterEach(() => {
  delete process.env.ASESORA_SOLO_VISITAS;
});

test("apagado por defecto: sin la variable no frena nada", () => {
  delete process.env.ASESORA_SOLO_VISITAS;
  assert.strictEqual(soloVisitas.activo(), false);
  assert.strictEqual(soloVisitas.frena("x"), false);
});

test("solo 'true' lo prende", () => {
  process.env.ASESORA_SOLO_VISITAS = "false";
  assert.strictEqual(soloVisitas.activo(), false);
  process.env.ASESORA_SOLO_VISITAS = "true";
  assert.strictEqual(soloVisitas.activo(), true);
});

test("prendido: ningun scheduler de seguimiento le escribe a la asesora", async (t) => {
  process.env.ASESORA_SOLO_VISITAS = "true";
  const listActive = t.mock.method(organizations, "listActive", async () => [{ id: "org-1" }]);
  const envios = [];
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async (...a) => (envios.push(a), { ok: true }));
  t.mock.method(canalWhatsapp, "sendWhatsApp", async (...a) => (envios.push(a), { ok: true }));
  t.mock.method(canalWhatsapp, "sendWhatsAppTemplate", async (...a) => (envios.push(a), { ok: true }));

  assert.deepStrictEqual(await silencio.runOnce(), { sent: 0 });
  assert.deepStrictEqual(await avisosSalida.runOnce(), []);
  assert.deepStrictEqual(await cierreDia.runOnce({ forzar: true }), { enviados: 0 });
  assert.deepStrictEqual(await digest.runOnce({ forzar: true }), { enviados: 0 });
  assert.deepStrictEqual(await recordatorio.runOnce(), { sent: 0 });

  assert.strictEqual(envios.length, 0);
  assert.strictEqual(listActive.mock.callCount(), 0);
});

test("prendido: el escalado de un mandato no sale", async (t) => {
  process.env.ASESORA_SOLO_VISITAS = "true";
  const envio = t.mock.method(mensajeAsesor, "enviarYRegistrar", async () => ({ ok: true }));
  const ok = await avisarMandato.escalar({ id: "org-1" }, { texto: "x", mandato: { id: "m" }, motivo: "y", alertaId: "a" });
  assert.strictEqual(ok, false);
  assert.strictEqual(envio.mock.callCount(), 0);
});

test("visitas-venta respeta el interruptor", async (t) => {
  process.env.ASESORA_SOLO_VISITAS = "true";
  const listActive = t.mock.method(organizations, "listActive", async () => [{ id: "org-1" }]);
  const r = await visitasVenta.runOnce({ forzar: true });
  assert.strictEqual(r.alertadas, 0);
  assert.strictEqual(listActive.mock.callCount(), 0);
});
