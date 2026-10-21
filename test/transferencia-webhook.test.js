// La transferencia por el webhook real (2026-10-21): primero sale la despedida
// de Sofi, despues el aviso por la campana y recien ahi la conversacion queda
// en modo humano. Y los avisos de captador y de aliado van por la campana,
// nunca como texto libre al celular de la asesora.
const { test } = require("node:test");
const assert = require("node:assert");

const config = require("../src/config");
config.metaAppSecret = null;

const organizations = require("../src/data/organizations");
const conversations = require("../src/data/conversations");
const engine = require("../src/agent/engine");
const avisar = require("../src/notifications/avisar-asesor");
const alertaSaldo = require("../src/lib/alerta-saldo");
const router = require("../src/channels/whatsapp");

const ORG = { id: "org-1", name: "Diamond", whatsapp_token: "tok", whatsapp_phone_id: "PID" };
const CLIENTE = "573023980359";
const DAIANA = { id: "adv-daiana", name: "Daiana", phone: "573011880668", activo: true };

function handler() {
  const capa = router.stack.find((c) => c.route?.path === "/webhook" && c.route.methods.post);
  return capa.route.stack[capa.route.stack.length - 1].handle;
}

async function entregar(wamid) {
  const message = { id: wamid, from: CLIENTE, timestamp: "1757538130", type: "text", text: { body: "quiero hablar con alguien" } };
  const req = { headers: {}, body: { entry: [{ changes: [{ value: { metadata: { phone_number_id: "PID" }, contacts: [{ wa_id: CLIENTE }], messages: [message] } }] }] } };
  const res = { sendStatus: () => res };
  await handler()(req, res);
  await new Promise((r) => setTimeout(r, 50));
}

function preparar(t, salida) {
  const orden = [];
  const graph = [];
  t.mock.method(organizations, "findByWhatsappPhoneId", async () => ORG);
  t.mock.method(organizations, "getDefault", async () => ORG);
  t.mock.method(engine, "procesarMensaje", async () => ({ reply: "Listo, te contacta Asesor 1.", lead: { id: "lead-1", nombre: "Laura" }, assistantMessageId: null, ...salida }));
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    const body = JSON.parse((opts && opts.body) || "{}");
    graph.push(body);
    if (body.to === CLIENTE) orden.push("despedida");
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.X" }] }) };
  });
  const campanas = [];
  t.mock.method(avisar, "avisarAsesor", async (a) => {
    orden.push(`campana:${a.motivo}`);
    campanas.push(a);
    return { ok: true, whatsapp: true };
  });
  t.mock.method(conversations, "setModo", async (id, modo) => {
    orden.push(`modo:${modo}`);
    return { id, modo };
  });
  t.mock.method(conversations, "appendMessage", async () => ({ id: "m" }));
  t.mock.method(alertaSaldo, "enviarAlertaTecnica", async () => orden.push("alerta"));
  return { orden, graph, campanas };
}

test("transferencia: despedida, campana y despues Sofi en pausa", async (t) => {
  const { orden, campanas } = preparar(t, {
    transfer: { advisor: DAIANA, advisorName: DAIANA.name, advisorPhone: DAIANA.phone, motivo: "calificado", especialidad: "venta", advisorAlert: "Nuevo lead", conversationId: "conv-1" },
  });
  await entregar("wamid.T1");
  assert.deepStrictEqual(orden, ["despedida", "campana:transferido", "modo:humano"]);
  assert.strictEqual(campanas[0].advisor.id, DAIANA.id);
});

test("captador y aliado: por la campana con el detalle, ningun texto libre a la asesora", async (t) => {
  const { orden, graph, campanas } = preparar(t, {
    captadorAlert: { advisor: DAIANA, advisorPhone: DAIANA.phone, advisorAlert: "Laura se interesó en la 10207832" },
    allyAlert: { advisor: DAIANA, advisorPhone: DAIANA.phone, advisorAlert: "Match de aliado con Laura" },
  });
  await entregar("wamid.T2");
  assert.deepStrictEqual(orden, ["despedida", "campana:aviso", "campana:aviso"]);
  assert.ok(campanas.some((c) => /10207832/.test(c.cuerpo)));
  assert.ok(campanas.some((c) => /aliado/.test(c.cuerpo)));
  assert.ok(!graph.some((b) => b.to === DAIANA.phone), "nada sale por Graph al celular de la asesora desde el canal");
});
