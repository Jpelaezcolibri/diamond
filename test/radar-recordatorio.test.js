// Empuja a la asesora a responder el aviso de un pedido del radar: sirve para
// calibrar (signal_events) y renueva la ventana de 24h de los avisos
// siguientes. Ver src/scheduler/radar-recordatorio.js.

const { test } = require("node:test");
const assert = require("node:assert");
// El freno de ritmo es de proceso (src/lib/ritmo-avisos.js): sin resetearlo,
// el segundo test veria "a esa asesora ya se le escribio" y no insistiria.
const ritmo = require("../src/lib/ritmo-avisos");

const recordatorio = require("../src/scheduler/radar-recordatorio");
const groupSignals = require("../src/data/group-signals");
const signalEvents = require("../src/data/signal-events");
const organizations = require("../src/data/organizations");
const advisors = require("../src/data/advisors");
const mensajeAsesor = require("../src/lib/mensaje-asesor");

const { beforeEach: _be } = require("node:test");
_be(() => ritmo._reset());

// BUG REAL (Juan, 2026-09-04): el saludo estaba HARDCODEADO como "Cathe,"
// aunque el mensaje se agrupa por aviso_advisor_id y sale a quien recibio el
// aviso. A Natalia le llego saludandola con el nombre de otra persona: "este
// mensaje fue respuesta para el numero de natalia, no entiendo por que le
// contesta cathe". Ahora el nombre sale del asesor real.
test("textoRecordatorio saluda al asesor QUE RECIBE, no a un nombre fijo", () => {
  const t = recordatorio.textoRecordatorio(
    [{ texto_original: "busco apto en Sabaneta 3 alcobas" }],
    { name: "Natalia Velez" }
  );
  assert.match(t, /^Natalia,/);
  assert.ok(!/Cathe/.test(t), "no puede saludar a otra persona");
  assert.match(t, /Sabaneta/);
  assert.match(t, /le escribi.*no servia.*hubo visita.*se cerro/i);
  assert.match(t, /muy importante/i);
});

test("textoRecordatorio usa el primer nombre de cada asesor", () => {
  const t = recordatorio.textoRecordatorio([{ texto_original: "x" }], { name: "Catherine Uribe" });
  assert.match(t, /^Catherine,/);
});

// Sin nombre NO se inventa uno ni se cae al de otra persona: se saluda neutro.
test("textoRecordatorio sin asesor no saluda a nadie por nombre", () => {
  const t = recordatorio.textoRecordatorio([{ texto_original: "x" }], null);
  assert.ok(!/^Cathe/.test(t) && !/^Natalia/.test(t), t.slice(0, 40));
  assert.ok(t.length > 0);
});

test("textoRecordatorio no truena sin texto_original", () => {
  const t = recordatorio.textoRecordatorio([{}], { name: "Natalia Velez" });
  assert.ok(t.length > 0);
});

// Juan, 2026-08-19: varios pedidos vencidos a la vez se avisan en UN solo
// mensaje, no uno por cada uno — antes se sentia como acoso.
test("textoRecordatorio: varias señales quedan en un solo mensaje, listadas", () => {
  const t = recordatorio.textoRecordatorio(
    [{ texto_original: "busco apto en Laureles" }, { texto_original: "busco casa en Envigado" }],
    { name: "Natalia Velez" }
  );
  assert.match(t, /^Natalia, tenes 2 pedidos/);
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

// APAGADO POR DEFECTO desde el 2026-09-06: lo reemplazo el cierre del dia
// (src/scheduler/cierre-dia.js). El codigo se queda para que volver atras
// cueste RADAR_RECORDATORIO_ENABLED=true y no un revert, asi que los tests
// que ejercitan el envio lo encienden a mano — igual que habria que hacerlo
// en produccion.
const config = require("../src/config");
// Este archivo corre en su propio proceso: encenderlo aca no afecta a nadie mas.
config.groups.recordatorio.enabled = true;

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
