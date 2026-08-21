// Cruce diario visitas -> ventas (Juan, 2026-08-21): "que todos los dias se
// haga el barrido con wasi y se cruce que propiedades se vendieron de esas
// visitas agendadas... quiero tener el control de las visitas y ventas".

const { test } = require("node:test");
const assert = require("node:assert");

// RADAR_VISITAS_ALERTA_TO se lee UNA vez al cargar el modulo — tiene que
// estar puesta ANTES del require (mismo gotcha que group-dm.test.js).
process.env.RADAR_VISITAS_ALERTA_TO = "573000000000";

const scheduler = require("../src/scheduler/visitas-venta");
const organizations = require("../src/data/organizations");
const properties = require("../src/data/properties");
const visitas = require("../src/data/visitas");
const mensajeAsesor = require("../src/lib/mensaje-asesor");

const ORG = { id: "org-1", name: "Diamond" };
const HORA = Number(process.env.VISITAS_VENTA_HORA || 8);

function aLaHora() {
  const d = new Date();
  d.setUTCHours(HORA + 5, 0, 0, 0); // Bogota = UTC-5
  return d;
}

function mockTodo(t, { visitasRecientes = [], disponible = false, yaAlertada = false, envioOk = true } = {}) {
  const enviados = [];
  const marcados = [];
  t.mock.method(organizations, "listActive", async () => [ORG]);
  t.mock.method(visitas, "recientes", async () => visitasRecientes);
  t.mock.method(visitas, "yaAlertada", async () => yaAlertada);
  t.mock.method(visitas, "marcarAlertada", async (orgId, ref) => { marcados.push(ref); return true; });
  t.mock.method(properties, "findByRef", async (orgId, ref) => ({ ref, titulo: `Propiedad ${ref}`, disponible }));
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async (org, telefono, texto) => {
    enviados.push({ telefono, texto });
    return envioOk ? { ok: true } : { ok: false, error: "timeout" };
  });
  return { enviados, marcados };
}

const VISITA = { ref: "9100417", origen: "colega", quien: "Felipe Velez", fechaHoraIso: "2026-08-20T16:00:00-05:00" };

test("fuera de la hora configurada, no revisa nada", async (t) => {
  mockTodo(t, { visitasRecientes: [VISITA] });
  const r = await scheduler.runOnce({ ahora: new Date("2026-08-21T12:00:00Z") });
  assert.deepStrictEqual(r, { revisadas: 0, alertadas: 0 });
});

test("una propiedad con visita agendada que SIGUE disponible no alerta", async (t) => {
  const { enviados } = mockTodo(t, { visitasRecientes: [VISITA], disponible: true });
  const r = await scheduler.runOnce({ ahora: aLaHora() });
  assert.strictEqual(r.alertadas, 0);
  assert.strictEqual(enviados.length, 0);
});

test("una propiedad con visita agendada que YA NO esta disponible SI alerta", async (t) => {
  const { enviados, marcados } = mockTodo(t, { visitasRecientes: [VISITA], disponible: false });
  const r = await scheduler.runOnce({ ahora: aLaHora() });
  assert.strictEqual(r.alertadas, 1);
  assert.strictEqual(enviados.length, 1);
  assert.match(enviados[0].texto, /9100417/);
  assert.match(enviados[0].texto, /Felipe Velez/);
  assert.deepStrictEqual(marcados, ["9100417"]);
});

test("un ref ya alertado antes no se vuelve a avisar", async (t) => {
  const { enviados } = mockTodo(t, { visitasRecientes: [VISITA], disponible: false, yaAlertada: true });
  const r = await scheduler.runOnce({ ahora: aLaHora() });
  assert.strictEqual(r.alertadas, 0);
  assert.strictEqual(enviados.length, 0);
});

test("dos visitas al mismo ref se cuentan una sola vez", async (t) => {
  const otraVisita = { ...VISITA, quien: "Otro colega" };
  mockTodo(t, { visitasRecientes: [VISITA, otraVisita], disponible: false });
  const r = await scheduler.runOnce({ ahora: aLaHora() });
  assert.strictEqual(r.revisadas, 1);
});

test("si el envio de la alerta falla, no se marca como alertada", async (t) => {
  const { marcados } = mockTodo(t, { visitasRecientes: [VISITA], disponible: false, envioOk: false });
  await scheduler.runOnce({ ahora: aLaHora() });
  assert.deepStrictEqual(marcados, []);
});

test("construirAlerta distingue cliente directo de colega en el texto", () => {
  const prop = { titulo: "Apto en Llanogrande" };
  const cliente = scheduler.construirAlerta("REF1", prop, { ...VISITA, origen: "cliente" });
  const colega = scheduler.construirAlerta("REF1", prop, { ...VISITA, origen: "colega" });
  assert.match(cliente, /cliente directo/);
  assert.match(colega, /colega de otra inmobiliaria/);
});
