// Escalado por SILENCIO a Catherine si Natalia (asesor PRINCIPAL del radar)
// no responde el aviso a tiempo, en los dos carriles (venta y compra).
// Ver src/scheduler/radar-silencio.js.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const silencio = require("../src/scheduler/radar-silencio");
const groupSignals = require("../src/data/group-signals");
const signalEvents = require("../src/data/signal-events");
const organizations = require("../src/data/organizations");
const mandatosData = require("../src/data/mandatos");
const avisarMandato = require("../src/groups/avisar-mandato");
const leads = require("../src/data/leads");
const conversations = require("../src/data/conversations");
const mensajeAsesor = require("../src/lib/mensaje-asesor");

const ORG = { id: "org-1", name: "Diamond" };

beforeEach(() => {
  process.env.RADAR_REVISOR_PHONE = "573001878024"; // Natalia
  process.env.RADAR_ESCALADO_PHONE = "573028536489"; // Catherine
});

// ── Carril de venta ────────────────────────────────────────────────────────

test("venta: un pedido sin resultado en signal_events, vencido, se escala a Catherine (con claim previo)", async (t) => {
  t.mock.method(organizations, "listActive", async () => [ORG]);
  t.mock.method(groupSignals, "candidatosEscaladoSilencio", async () => [
    { id: "sig-1", aviso_advisor_id: "adv-natalia", texto_original: "busco apto en Laureles" },
  ]);
  t.mock.method(signalEvents, "ultimoPorSenal", async () => new Map());
  t.mock.method(mandatosData, "pendientesDeSilencio", async () => []);
  const reclamos = [];
  t.mock.method(groupSignals, "claimEscaladoSilencio", async (orgId, signalId) => {
    reclamos.push(signalId);
    return true;
  });
  const enviados = [];
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async (org, to, texto) => {
    enviados.push({ to, texto });
    return { ok: true, wamid: "w1" };
  });

  const r = await silencio.runOnce();

  assert.strictEqual(r.sent, 1);
  assert.deepStrictEqual(reclamos, ["sig-1"]);
  assert.strictEqual(enviados.length, 1);
  assert.strictEqual(enviados[0].to, "573028536489");
  assert.match(enviados[0].texto, /Laureles/);
});

test("venta: un pedido CON resultado ya registrado no se escala", async (t) => {
  t.mock.method(organizations, "listActive", async () => [ORG]);
  t.mock.method(groupSignals, "candidatosEscaladoSilencio", async () => [
    { id: "sig-con-resultado", aviso_advisor_id: "adv-natalia", texto_original: "busco casa" },
  ]);
  t.mock.method(signalEvents, "ultimoPorSenal", async () => new Map([["sig-con-resultado", { tipo: "CIERRE" }]]));
  t.mock.method(mandatosData, "pendientesDeSilencio", async () => []);
  let reclamado = false;
  t.mock.method(groupSignals, "claimEscaladoSilencio", async () => { reclamado = true; return true; });
  let enviado = false;
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async () => { enviado = true; return { ok: true }; });

  const r = await silencio.runOnce();

  assert.strictEqual(r.sent, 0);
  assert.strictEqual(reclamado, false);
  assert.strictEqual(enviado, false);
});

test("venta: dos corridas seguidas sobre el mismo candidato solo mandan un escalado (claim atomico)", async (t) => {
  t.mock.method(organizations, "listActive", async () => [ORG]);
  t.mock.method(groupSignals, "candidatosEscaladoSilencio", async () => [
    { id: "sig-1", aviso_advisor_id: "adv-natalia", texto_original: "busco apto" },
  ]);
  t.mock.method(signalEvents, "ultimoPorSenal", async () => new Map());
  t.mock.method(mandatosData, "pendientesDeSilencio", async () => []);
  let yaReclamado = false;
  t.mock.method(groupSignals, "claimEscaladoSilencio", async () => {
    if (yaReclamado) return false;
    yaReclamado = true;
    return true;
  });
  const enviados = [];
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async (org, to, texto) => {
    enviados.push({ to, texto });
    return { ok: true, wamid: "w1" };
  });

  const r1 = await silencio.runOnce();
  const r2 = await silencio.runOnce();

  assert.strictEqual(r1.sent, 1);
  assert.strictEqual(r2.sent, 0);
  assert.strictEqual(enviados.length, 1);
});

// ── Carril de compra ───────────────────────────────────────────────────────

const MANDATO = { id: "mandato-1", cliente_nombre: "Marcela Restrepo", advisor_id: "adv-nat" };

function conFecha(msAtras) {
  return new Date(Date.now() - msAtras).toISOString();
}

test("compra: un match entregado hace mas de 30 min, sin mensaje de Natalia despues, se escala reenviando el texto guardado", async (t) => {
  t.mock.method(organizations, "listActive", async () => [ORG]);
  t.mock.method(groupSignals, "candidatosEscaladoSilencio", async () => []);
  t.mock.method(mandatosData, "pendientesDeSilencio", async () => [
    { id: "alerta-1", mandato_id: "mandato-1", texto: "texto original del aviso", entregado_at: conFecha(40 * 60 * 1000) },
  ]);
  t.mock.method(mandatosData, "findById", async () => MANDATO);
  t.mock.method(leads, "findOrCreate", async () => ({ id: "lead-natalia" }));
  t.mock.method(conversations, "findOrCreate", async () => ({ id: "conv-natalia" }));
  t.mock.method(conversations, "lastMessage", async () => null); // Natalia nunca respondio
  const escalados = [];
  t.mock.method(avisarMandato, "escalar", async (org, datos) => { escalados.push(datos); return true; });

  const r = await silencio.runOnce();

  assert.strictEqual(r.sent, 1);
  assert.strictEqual(escalados.length, 1);
  assert.strictEqual(escalados[0].texto, "texto original del aviso");
  assert.strictEqual(escalados[0].mandato.id, "mandato-1");
  assert.strictEqual(escalados[0].alertaId, "alerta-1");
});

test("compra: un mensaje de Natalia DESPUES de entregado_at cuenta como respuesta -- NO se escala", async (t) => {
  t.mock.method(organizations, "listActive", async () => [ORG]);
  t.mock.method(groupSignals, "candidatosEscaladoSilencio", async () => []);
  const entregadoAt = conFecha(40 * 60 * 1000);
  t.mock.method(mandatosData, "pendientesDeSilencio", async () => [
    { id: "alerta-1", mandato_id: "mandato-1", texto: "texto original", entregado_at: entregadoAt },
  ]);
  t.mock.method(mandatosData, "findById", async () => MANDATO);
  t.mock.method(leads, "findOrCreate", async () => ({ id: "lead-natalia" }));
  t.mock.method(conversations, "findOrCreate", async () => ({ id: "conv-natalia" }));
  t.mock.method(conversations, "lastMessage", async () => ({ role: "user", content: "ya le escribi", created_at: conFecha(5 * 60 * 1000) }));
  let escalado = false;
  t.mock.method(avisarMandato, "escalar", async () => { escalado = true; return true; });

  const r = await silencio.runOnce();

  assert.strictEqual(r.sent, 0);
  assert.strictEqual(escalado, false);
});

test("compra: un mensaje de Natalia ANTES de entregado_at (conversacion vieja, no relacionada) SI escala", async (t) => {
  t.mock.method(organizations, "listActive", async () => [ORG]);
  t.mock.method(groupSignals, "candidatosEscaladoSilencio", async () => []);
  const entregadoAt = conFecha(40 * 60 * 1000);
  t.mock.method(mandatosData, "pendientesDeSilencio", async () => [
    { id: "alerta-1", mandato_id: "mandato-1", texto: "texto original", entregado_at: entregadoAt },
  ]);
  t.mock.method(mandatosData, "findById", async () => MANDATO);
  t.mock.method(leads, "findOrCreate", async () => ({ id: "lead-natalia" }));
  t.mock.method(conversations, "findOrCreate", async () => ({ id: "conv-natalia" }));
  // Mensaje viejo, de ANTES de que este aviso saliera -- no es una respuesta a este match.
  t.mock.method(conversations, "lastMessage", async () => ({ role: "user", content: "hola", created_at: conFecha(90 * 60 * 1000) }));
  let escalado = false;
  t.mock.method(avisarMandato, "escalar", async () => { escalado = true; return true; });

  const r = await silencio.runOnce();

  assert.strictEqual(r.sent, 1);
  assert.strictEqual(escalado, true);
});

test("compra: dos corridas seguidas sobre el mismo match solo escalan una vez (pendientesDeSilencio deja de traerlo tras marcar escalado_a)", async (t) => {
  t.mock.method(organizations, "listActive", async () => [ORG]);
  t.mock.method(groupSignals, "candidatosEscaladoSilencio", async () => []);
  let yaEscalado = false;
  t.mock.method(mandatosData, "pendientesDeSilencio", async () => (
    yaEscalado ? [] : [{ id: "alerta-1", mandato_id: "mandato-1", texto: "texto original", entregado_at: conFecha(40 * 60 * 1000) }]
  ));
  t.mock.method(mandatosData, "findById", async () => MANDATO);
  t.mock.method(leads, "findOrCreate", async () => ({ id: "lead-natalia" }));
  t.mock.method(conversations, "findOrCreate", async () => ({ id: "conv-natalia" }));
  t.mock.method(conversations, "lastMessage", async () => null);
  let escalos = 0;
  t.mock.method(avisarMandato, "escalar", async () => { escalos++; yaEscalado = true; return true; });

  const r1 = await silencio.runOnce();
  const r2 = await silencio.runOnce();

  assert.strictEqual(r1.sent, 1);
  assert.strictEqual(r2.sent, 0);
  assert.strictEqual(escalos, 1);
});
