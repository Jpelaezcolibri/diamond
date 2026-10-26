// Todo al chat del CRM (Juan, 2026-10-07): el pendiente se marca en el lead,
// el asesor lo ve en la app (campana + push con link al chat) y por WhatsApp
// solo le llega un aviso corto SIN datos del cliente.
const { test } = require("node:test");
const assert = require("node:assert");
const { avisarAsesor, MOTIVOS } = require("../src/notifications/avisar-asesor");

const ORG = { id: "org-1", name: "Diamond" };
const ADV = { id: "a1", name: "Daiana Zea", phone: "573011880668", alias_publico: "Asesor 1" };
const LEAD = { id: "l1", nombre: "Laura", phone: "573125550000" };

function deps(over = {}) {
  const log = { updates: [], notas: [], plantillas: [], textos: [] };
  return {
    log,
    d: {
      actualizarLead: async (id, patch) => log.updates.push({ id, patch }),
      conversacion: async () => "c9",
      notificar: async (n) => { log.notas.push(n); return { ok: true }; },
      plantilla: async (_o, to, opts) => { log.plantillas.push({ to, opts }); return { ok: true }; },
      texto: async (_o, to, t) => { log.textos.push({ to, t }); return { ok: true }; },
      ...over,
    },
  };
}

test("pide_asesor: asigna y marca el chat, notifica con link al chat y manda el aviso corto", async () => {
  const { log, d } = deps();
  const r = await avisarAsesor({ org: ORG, advisor: ADV, motivo: "pide_asesor", lead: LEAD, titulo: "Laura pide hablar con un asesor", cuerpo: "ver la ref 10012722" }, d);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(log.updates[0].patch.atencion_pendiente, "pide_asesor");
  assert.strictEqual(log.updates[0].patch.transferido_advisor_id, "a1");
  assert.ok(log.updates[0].patch.atencion_desde);
  assert.strictEqual(log.notas[0].link, "/inbox/c9");
  assert.strictEqual(log.notas[0].tipo, "asesor_solicitado");
  assert.strictEqual(log.plantillas[0].opts.name, "aviso_app");
  assert.deepStrictEqual(log.plantillas[0].opts.bodyParams, [MOTIVOS.pide_asesor.whatsapp]);
  assert.doesNotMatch(JSON.stringify(log.plantillas), /Laura|573125550000|10012722/, "el WhatsApp no lleva datos del cliente");
});

test("visita: marca el chat pero no toca la asignación (la dueña es cita.asesor_id)", async () => {
  const { log, d } = deps();
  await avisarAsesor({ org: ORG, advisor: ADV, motivo: "visita", lead: LEAD, titulo: "Nueva visita por confirmar" }, d);
  assert.strictEqual(log.updates[0].patch.atencion_pendiente, "visita");
  assert.strictEqual(log.updates[0].patch.transferido_advisor_id, undefined);
  assert.strictEqual(log.notas[0].tipo, "cita_por_confirmar");
});

test("aviso informativo: no marca nada en el lead", async () => {
  const { log, d } = deps();
  await avisarAsesor({ org: ORG, advisor: ADV, motivo: "aviso", lead: LEAD, titulo: "Interés en tu captación" }, d);
  assert.strictEqual(log.updates.length, 0);
  assert.strictEqual(log.notas[0].tipo, "aviso");
});

test("si la plantilla no está aprobada, cae a un texto corto igual de pelado", async () => {
  const { log, d } = deps({ plantilla: async () => ({ ok: false, error: "template not approved" }) });
  await avisarAsesor({ org: ORG, advisor: ADV, motivo: "transferido", lead: LEAD, titulo: "Te transfirieron a Laura" }, d);
  assert.strictEqual(log.textos.length, 1);
  assert.match(log.textos[0].t, /pendiente en la app de Diamond/);
  assert.doesNotMatch(log.textos[0].t, /Laura|573125550000/);
});

test("sin asesor no hace nada", async () => {
  const { log, d } = deps();
  assert.strictEqual((await avisarAsesor({ org: ORG, advisor: null, motivo: "pide_asesor", lead: LEAD, titulo: "x" }, d)).ok, false);
  assert.strictEqual(log.notas.length, 0);
});

// El cableado del webhook (transferencia, captador, aliado por la campana) lo
// prueban de verdad test/transferencia-webhook.test.js y
// test/aviso-cita-respaldo.test.js; aca no se hace grep sobre el fuente.

// ── Que le llego de verdad (revision 2026-10-21) ──────────────────────────

test("ok solo si le llego en tiempo real: plantilla aviso_app", async () => {
  const { d } = deps({ notificar: async () => ({ ok: true, push: 0 }) });
  const r = await avisarAsesor({ org: ORG, advisor: ADV, motivo: "transferido", lead: LEAD, titulo: "x" }, d);
  assert.deepStrictEqual(r, { ok: true, campana: true, push: 0, whatsapp: true });
});

test("ok con push aunque el WhatsApp falle", async () => {
  const { d } = deps({
    notificar: async () => ({ ok: true, push: 2 }),
    plantilla: async () => ({ ok: false, error: "no aprobada" }),
    texto: async () => ({ ok: false, error: "fuera de la ventana" }),
  });
  const r = await avisarAsesor({ org: ORG, advisor: ADV, motivo: "transferido", lead: LEAD, titulo: "x" }, d);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.push, 2);
  assert.strictEqual(r.whatsapp, false);
});

test("solo la campana NO cuenta: sin push y sin WhatsApp, ok es false y lo dice", async () => {
  const { d } = deps({
    notificar: async () => ({ ok: true, push: 0 }),
    plantilla: async () => ({ ok: false, error: "no aprobada" }),
    texto: async () => ({ ok: false, error: "fuera de la ventana" }),
  });
  const r = await avisarAsesor({ org: ORG, advisor: ADV, motivo: "transferido", lead: LEAD, titulo: "x" }, d);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.campana, true);
  assert.strictEqual(r.whatsapp, false);
  assert.match(r.error, /solo en la campana/);
});

test("si la campana se cae (lanza) y no hay telefono, nada llego", async () => {
  const { d } = deps({ notificar: async () => { throw new Error("db caida"); } });
  const r = await avisarAsesor({ org: ORG, advisor: { ...ADV, phone: "" }, motivo: "aviso", lead: LEAD, titulo: "x" }, d);
  assert.deepStrictEqual({ ok: r.ok, campana: r.campana, push: r.push, whatsapp: r.whatsapp }, { ok: false, campana: false, push: 0, whatsapp: false });
});

test("whatsapp:false no manda plantilla ni texto pero sí notifica", async () => {
  const { log, d } = deps();
  const r = await avisarAsesor({ org: ORG, advisor: ADV, motivo: "pregunta", lead: LEAD, titulo: "Pregunta", cuerpo: "¿precio?", whatsapp: false }, d);
  assert.strictEqual(log.plantillas.length, 0);
  assert.strictEqual(log.textos.length, 0);
  assert.strictEqual(log.notas.length, 1);
  assert.strictEqual(r.whatsapp, false);
});
