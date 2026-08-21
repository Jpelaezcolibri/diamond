// Boton "Sí, publicar" / "No sirve" del aviso del radar (Juan, 2026-08-21:
// "se esta enredando con las respuestas y estamos perdiendo es plata"). El
// id del boton lleva la señal adentro (ver src/groups/vivo.js#avisarCercano),
// asi que procesarBotonRadar resuelve la accion directo, sin pasar por Claude
// ni por la desambiguacion de pendientes que usa el camino de texto libre.

const { test } = require("node:test");
const assert = require("node:assert");

const { procesarBotonRadar } = require("../src/channels/whatsapp");
const advisors = require("../src/data/advisors");
const leads = require("../src/data/leads");
const conversations = require("../src/data/conversations");
const tools = require("../src/agent/tools");
const mensajeAsesor = require("../src/lib/mensaje-asesor");

const ORG = { id: "org-1", name: "Diamond" };
const NATALIA = { id: "adv-natalia", name: "Natalia Velez", phone: "573001878024" };

function mockearBase(t, { advisor = NATALIA } = {}) {
  t.mock.method(advisors, "findByPhone", async () => advisor);
  t.mock.method(leads, "findOrCreate", async () => ({ id: "lead-1" }));
  t.mock.method(conversations, "findOrCreate", async () => ({ id: "conv-1" }));
  const appended = [];
  t.mock.method(conversations, "appendMessage", async (convId, role, content) => {
    appended.push({ convId, role, content });
    return { id: "msg-1" };
  });
  return { appended };
}

test("boton 'Sí, publicar': llama aprobarPedidoRadar con el signalId resuelto del boton, sin preguntar", async (t) => {
  const { appended } = mockearBase(t);
  let ctxRecibido = null;
  t.mock.method(tools, "aprobarPedidoRadar", async (input, ctx) => {
    ctxRecibido = ctx;
    return "Listo, publicado en el grupo:\n\ntexto...";
  });
  let confirmacion = null;
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async (org, telefono, texto) => {
    confirmacion = { org, telefono, texto };
    return { ok: true, wamid: "w1" };
  });

  await procesarBotonRadar(ORG, "573001878024", "radar_si:sig-42", "Sí, publicar", "phone-id-1");

  assert.strictEqual(ctxRecibido.radarSignalId, "sig-42");
  assert.strictEqual(ctxRecibido.advisor.id, "adv-natalia");
  assert.strictEqual(ctxRecibido.org.id, "org-1");
  assert.strictEqual(confirmacion.telefono, "573001878024");
  assert.match(confirmacion.texto, /publicado/);
  assert.strictEqual(appended[0].role, "user");
  assert.match(appended[0].content, /Sí, publicar/);
});

test("boton 'No sirve': llama rechazarPedidoRadar, no aprobarPedidoRadar", async (t) => {
  mockearBase(t);
  let seLlamoAprobar = false;
  let ctxRecibido = null;
  t.mock.method(tools, "aprobarPedidoRadar", async () => { seLlamoAprobar = true; return ""; });
  t.mock.method(tools, "rechazarPedidoRadar", async (input, ctx) => {
    ctxRecibido = ctx;
    return "Listo, quedo registrado que no sirve.";
  });
  let confirmacion = null;
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async (org, telefono, texto) => {
    confirmacion = texto;
    return { ok: true, wamid: "w2" };
  });

  await procesarBotonRadar(ORG, "573001878024", "radar_no:sig-99", "No sirve", "phone-id-1");

  assert.strictEqual(seLlamoAprobar, false);
  assert.strictEqual(ctxRecibido.radarSignalId, "sig-99");
  assert.match(confirmacion, /no sirve/);
});

test("un boton de otro origen (id sin el prefijo radar_) se ignora sin tronar", async (t) => {
  mockearBase(t);
  let seLlamo = false;
  t.mock.method(tools, "aprobarPedidoRadar", async () => { seLlamo = true; return ""; });
  t.mock.method(tools, "rechazarPedidoRadar", async () => { seLlamo = true; return ""; });
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async () => { seLlamo = true; return { ok: true }; });

  await procesarBotonRadar(ORG, "573001878024", "otra_cosa:sig-1", "Otro boton", "phone-id-1");

  assert.strictEqual(seLlamo, false);
});

test("un numero que no es asesor no dispara nada (el boton solo se manda a asesores)", async (t) => {
  t.mock.method(advisors, "findByPhone", async () => null);
  let seLlamo = false;
  t.mock.method(tools, "aprobarPedidoRadar", async () => { seLlamo = true; return ""; });
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async () => { seLlamo = true; return { ok: true }; });

  await procesarBotonRadar(ORG, "573000000000", "radar_si:sig-1", "Sí, publicar", "phone-id-1");

  assert.strictEqual(seLlamo, false);
});
