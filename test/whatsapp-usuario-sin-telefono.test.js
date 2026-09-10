// USUARIOS DE WHATSAPP SIN TELEFONO (2026-09-10).
//
// Quien activa el "nombre de usuario" de WhatsApp puede llegar al webhook de
// Meta SIN `from`, solo con `from_user_id` (ej. "CO.13491208655302741918").
// En produccion eso dejaba userPhone en undefined, el insert del lead
// reventaba contra el NOT NULL de leads.phone y el mensaje se perdia: 3 en 4
// minutos el 2026-09-10.
//
// Se mete un body de webhook de Meta tal como llega por el handler real del
// router (mismo patron que test/linea-dm-webhook.test.js) y se afirma sobre
// lo que recibe procesarMensaje y sobre el body que sale hacia Graph.

const { test } = require("node:test");
const assert = require("node:assert");

const config = require("../src/config");
config.metaAppSecret = null;

const organizations = require("../src/data/organizations");
const engine = require("../src/agent/engine");
const router = require("../src/channels/whatsapp");

const ORG = { id: "org-1", name: "Diamond", whatsapp_token: "tok", whatsapp_phone_id: "PID" };
const BSUID = "CO.13491208655302741918";

function handler() {
  const capa = router.stack.find((c) => c.route?.path === "/webhook" && c.route.methods.post);
  assert.ok(capa, "No existe POST /webhook");
  return capa.route.stack[capa.route.stack.length - 1].handle;
}

function webhookMeta({ from, fromUserId, contactoUserId, texto = "Hola, quiero información sobre sus propiedades" }) {
  const message = { id: "wamid.ENTRA", timestamp: "1757538130", type: "text", text: { body: texto } };
  if (from) message.from = from;
  if (fromUserId) message.from_user_id = fromUserId;
  const contacto = { profile: { name: "Cliente", username: "cliente.medellin" } };
  if (from) contacto.wa_id = from;
  if (contactoUserId) contacto.user_id = contactoUserId;
  return {
    headers: {},
    body: {
      entry: [{ changes: [{ value: { metadata: { phone_number_id: "PID" }, contacts: [contacto], messages: [message] } }] }],
    },
  };
}

function preparar(t) {
  const procesados = [];
  const enviados = [];
  t.mock.method(organizations, "findByWhatsappPhoneId", async () => ORG);
  t.mock.method(organizations, "getDefault", async () => ORG);
  t.mock.method(engine, "procesarMensaje", async (args) => {
    procesados.push(args);
    return { reply: "¡Hola! Soy Sofi.", assistantMessageId: null };
  });
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    enviados.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.SALE" }] }) };
  });
  return { procesados, enviados };
}

async function entregar(req) {
  const res = { sendStatus: () => res };
  await handler()(req, res);
  // El handler responde 200 y procesa encolado: se deja drenar la cola.
  await new Promise((r) => setTimeout(r, 50));
}

test("usuario sin telefono: se atiende con su from_user_id y la respuesta sale con recipient", async (t) => {
  const { procesados, enviados } = preparar(t);
  await entregar(webhookMeta({ fromUserId: BSUID, contactoUserId: BSUID }));

  assert.strictEqual(procesados.length, 1, "el mensaje tiene que llegar a Sofi");
  assert.strictEqual(procesados[0].phone, BSUID);
  assert.strictEqual(enviados.length, 1, "Sofi tiene que contestar");
  assert.strictEqual(enviados[0].body.recipient, BSUID);
  assert.ok(!("to" in enviados[0].body), "a un id de usuario no se le manda `to`");
});

test("si solo viene en contacts.user_id, tambien se atiende", async (t) => {
  const { procesados } = preparar(t);
  await entregar(webhookMeta({ contactoUserId: BSUID }));
  assert.strictEqual(procesados[0]?.phone, BSUID);
});

test("con telefono visible manda el telefono, aunque traiga from_user_id", async (t) => {
  const { procesados, enviados } = preparar(t);
  await entregar(webhookMeta({ from: "573001112233", fromUserId: BSUID, contactoUserId: BSUID }));

  assert.strictEqual(procesados[0].phone, "573001112233");
  assert.strictEqual(enviados[0].body.to, "573001112233");
  assert.ok(!("recipient" in enviados[0].body));
});

test("sin ningun remitente no llega a Sofi ni revienta", async (t) => {
  const { procesados, enviados } = preparar(t);
  t.mock.method(console, "error", () => {});
  await entregar(webhookMeta({}));
  assert.strictEqual(procesados.length, 0);
  assert.strictEqual(enviados.length, 0);
});
