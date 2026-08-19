// Empuja a la asesora a responder el aviso de un pedido del radar: sirve para
// calibrar (signal_events) y renueva la ventana de 24h de los avisos
// siguientes. Ver src/scheduler/radar-recordatorio.js.

const { test } = require("node:test");
const assert = require("node:assert");

const recordatorio = require("../src/scheduler/radar-recordatorio");
const groupSignals = require("../src/data/group-signals");
const signalEvents = require("../src/data/signal-events");
const organizations = require("../src/data/organizations");
const advisors = require("../src/data/advisors");
const mensajeAsesor = require("../src/lib/mensaje-asesor");

test("textoRecordatorio: una sola señal incluye el pedido, saluda 'Cathe' y pide un resultado corto", () => {
  const t = recordatorio.textoRecordatorio([{ texto_original: "busco apto en Sabaneta 3 alcobas" }]);
  assert.match(t, /^Cathe,/);
  assert.match(t, /Sabaneta/);
  assert.match(t, /le escribi.*no servia.*hubo visita.*se cerro/i);
  assert.match(t, /muy importante/i);
});

test("textoRecordatorio no truena sin texto_original", () => {
  const t = recordatorio.textoRecordatorio([{}]);
  assert.ok(t.length > 0);
});

// Juan, 2026-08-19: varios pedidos vencidos a la vez se avisan en UN solo
// mensaje, no uno por cada uno — antes se sentia como acoso.
test("textoRecordatorio: varias señales quedan en un solo mensaje, listadas", () => {
  const t = recordatorio.textoRecordatorio([
    { texto_original: "busco apto en Laureles" },
    { texto_original: "busco casa en Envigado" },
  ]);
  assert.match(t, /tenes 2 pedidos/);
  assert.match(t, /Laureles/);
  assert.match(t, /Envigado/);
});

test("candidatosDeOrg descarta las señales que ya tienen resultado registrado", async (t) => {
  t.mock.method(groupSignals, "candidatosRecordatorio", async () => [
    { id: "sig-sin-resultado", aviso_advisor_id: "adv-1", texto_original: "a" },
    { id: "sig-con-resultado", aviso_advisor_id: "adv-1", texto_original: "b" },
  ]);
  t.mock.method(signalEvents, "ultimoPorSenal", async () => new Map([["sig-con-resultado", { tipo: "CIERRE" }]]));

  const out = await recordatorio.candidatosDeOrg({ id: "org-1" }, "2026-08-18T00:00:00Z");

  assert.deepStrictEqual(out.map((s) => s.id), ["sig-sin-resultado"]);
});

test("candidatosDeOrg no llama a signalEvents si no hay candidatos (evita una query vacia)", async (t) => {
  t.mock.method(groupSignals, "candidatosRecordatorio", async () => []);
  let llamado = false;
  t.mock.method(signalEvents, "ultimoPorSenal", async () => { llamado = true; return new Map(); });

  await recordatorio.candidatosDeOrg({ id: "org-1" }, "2026-08-18T00:00:00Z");

  assert.strictEqual(llamado, false);
});

test("runOnce: reclama, resuelve el asesor y manda el recordatorio", async (t) => {
  t.mock.method(organizations, "listActive", async () => [{ id: "org-1", name: "Diamond" }]);
  t.mock.method(groupSignals, "candidatosRecordatorio", async () => [
    { id: "sig-1", aviso_advisor_id: "adv-catherine", texto_original: "busco apto en Laureles" },
  ]);
  t.mock.method(signalEvents, "ultimoPorSenal", async () => new Map());
  let reclamado = null;
  t.mock.method(groupSignals, "claimRecordatorio", async (orgId, signalId) => { reclamado = signalId; return true; });
  t.mock.method(advisors, "findById", async (orgId, id) => ({ id, name: "katherine Uribe", phone: "573028536489" }));
  const enviados = [];
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async (org, to, texto) => { enviados.push({ to, texto }); return { ok: true, wamid: "w1" }; });

  const r = await recordatorio.runOnce();

  assert.strictEqual(r.sent, 1);
  assert.strictEqual(reclamado, "sig-1");
  assert.strictEqual(enviados.length, 1);
  assert.strictEqual(enviados[0].to, "573028536489");
});

test("si el claim no lo gana (otro tick ya lo tomo), no manda nada", async (t) => {
  t.mock.method(organizations, "listActive", async () => [{ id: "org-1", name: "Diamond" }]);
  t.mock.method(groupSignals, "candidatosRecordatorio", async () => [
    { id: "sig-1", aviso_advisor_id: "adv-catherine", texto_original: "x" },
  ]);
  t.mock.method(signalEvents, "ultimoPorSenal", async () => new Map());
  t.mock.method(groupSignals, "claimRecordatorio", async () => false);
  let enviado = false;
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async () => { enviado = true; return { ok: true }; });

  const r = await recordatorio.runOnce();

  assert.strictEqual(r.sent, 0);
  assert.strictEqual(enviado, false);
});

test("runOnce: varios pedidos pendientes de LA MISMA asesora se consolidan en un solo WhatsApp", async (t) => {
  t.mock.method(organizations, "listActive", async () => [{ id: "org-1", name: "Diamond" }]);
  t.mock.method(groupSignals, "candidatosRecordatorio", async () => [
    { id: "sig-1", aviso_advisor_id: "adv-catherine", texto_original: "busco apto en Laureles" },
    { id: "sig-2", aviso_advisor_id: "adv-catherine", texto_original: "busco casa en Envigado" },
    { id: "sig-3", aviso_advisor_id: "adv-catherine", texto_original: "busco lote en Sabaneta" },
  ]);
  t.mock.method(signalEvents, "ultimoPorSenal", async () => new Map());
  const reclamadas = [];
  t.mock.method(groupSignals, "claimRecordatorio", async (orgId, signalId) => { reclamadas.push(signalId); return true; });
  t.mock.method(advisors, "findById", async (orgId, id) => ({ id, name: "katherine Uribe", phone: "573028536489" }));
  const enviados = [];
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async (org, to, texto) => { enviados.push({ to, texto }); return { ok: true, wamid: "w1" }; });

  const r = await recordatorio.runOnce();

  // sent cuenta MENSAJES enviados, no señales — es la metrica que le importa
  // a Juan (cuantos WhatsApp le llegaron a la asesora), no cuantos pedidos
  // venian adentro.
  assert.strictEqual(r.sent, 1);
  assert.deepStrictEqual(reclamadas, ["sig-1", "sig-2", "sig-3"]);
  assert.strictEqual(enviados.length, 1);
  assert.match(enviados[0].texto, /tenes 3 pedidos/);
  assert.match(enviados[0].texto, /Laureles/);
  assert.match(enviados[0].texto, /Envigado/);
  assert.match(enviados[0].texto, /Sabaneta/);
});

test("runOnce: pedidos pendientes de DOS asesoras distintas mandan DOS mensajes separados", async (t) => {
  t.mock.method(organizations, "listActive", async () => [{ id: "org-1", name: "Diamond" }]);
  t.mock.method(groupSignals, "candidatosRecordatorio", async () => [
    { id: "sig-1", aviso_advisor_id: "adv-catherine", texto_original: "busco apto en Laureles" },
    { id: "sig-2", aviso_advisor_id: "adv-natalia", texto_original: "busco local en Sabaneta" },
  ]);
  t.mock.method(signalEvents, "ultimoPorSenal", async () => new Map());
  t.mock.method(groupSignals, "claimRecordatorio", async () => true);
  t.mock.method(advisors, "findById", async (orgId, id) => ({
    id, name: id === "adv-catherine" ? "katherine Uribe" : "Natalia Velez",
    phone: id === "adv-catherine" ? "573028536489" : "573001112222",
  }));
  const enviados = [];
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async (org, to, texto) => { enviados.push({ to, texto }); return { ok: true, wamid: "w1" }; });

  const r = await recordatorio.runOnce();

  assert.strictEqual(r.sent, 2);
  assert.deepStrictEqual(enviados.map((e) => e.to).sort(), ["573001112222", "573028536489"]);
});

test("sin telefono del asesor, no truena y no cuenta como enviado", async (t) => {
  t.mock.method(organizations, "listActive", async () => [{ id: "org-1", name: "Diamond" }]);
  t.mock.method(groupSignals, "candidatosRecordatorio", async () => [
    { id: "sig-1", aviso_advisor_id: "adv-sin-telefono", texto_original: "x" },
  ]);
  t.mock.method(signalEvents, "ultimoPorSenal", async () => new Map());
  t.mock.method(groupSignals, "claimRecordatorio", async () => true);
  t.mock.method(advisors, "findById", async () => ({ id: "adv-sin-telefono", name: "Sin Telefono", phone: null }));
  let enviado = false;
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async () => { enviado = true; return { ok: true }; });

  const r = await recordatorio.runOnce();

  assert.strictEqual(r.sent, 0);
  assert.strictEqual(enviado, false);
});
