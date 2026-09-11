// EL AVISO DE UNA CITA NO SE PUEDE PERDER (Juan, 2026-09-11).
//
// "siempre las citas van al numero de Daiana que tiene la ventana abierta...
// el principal es el que tenemos con la automatizacion de la ventana abierta
// y luego al otro numero".
//
// Caso real: la visita de Sebastian Velasquez (11-sep, 3:00 p. m.) se aviso
// con un sendWhatsApp directo a una asesora con la ventana cerrada hacia
// 142 h. WhatsApp no se lo entrego y nada lo dijo. Ahora el aviso sale por
// entregarConRespaldo: si la ventana de la coordinadora esta cerrada, pasa al
// numero de respaldo (RADAR_ESCALADO_PHONE).
//
// Se mete un body de webhook de Meta por el handler real del router (mismo
// patron que test/whatsapp-usuario-sin-telefono.test.js).

const { test } = require("node:test");
const assert = require("node:assert");

const config = require("../src/config");
config.metaAppSecret = null;

const organizations = require("../src/data/organizations");
const engine = require("../src/agent/engine");
const advisors = require("../src/data/advisors");
const mensajeAsesor = require("../src/lib/mensaje-asesor");
const router = require("../src/channels/whatsapp");

const ORG = { id: "org-1", name: "Diamond", whatsapp_token: "tok", whatsapp_phone_id: "PID" };
const CERRADA = "(#131047) Message failed to send because more than 24 hours have passed";
const PRINCIPAL = "573011880668";
const RESPALDO = "573001878024";

function handler() {
  const capa = router.stack.find((c) => c.route?.path === "/webhook" && c.route.methods.post);
  assert.ok(capa, "No existe POST /webhook");
  return capa.route.stack[capa.route.stack.length - 1].handle;
}

function webhookMeta(wamid) {
  const message = { id: wamid, from: "573023980359", timestamp: "1757538130", type: "text", text: { body: "La podemos ver mañana a las 3?" } };
  return {
    headers: {},
    body: {
      entry: [{ changes: [{ value: { metadata: { phone_number_id: "PID" }, contacts: [{ wa_id: "573023980359", profile: { name: "Sebastian" } }], messages: [message] } }] }],
    },
  };
}

async function entregar(req) {
  const res = { sendStatus: () => res };
  await handler()(req, res);
  // El handler responde 200 y procesa encolado: se deja drenar la cola.
  await new Promise((r) => setTimeout(r, 50));
}

function preparar(t, resultadoPorTelefono) {
  t.mock.method(organizations, "findByWhatsappPhoneId", async () => ORG);
  t.mock.method(organizations, "getDefault", async () => ORG);
  t.mock.method(engine, "procesarMensaje", async () => ({
    reply: "Quedó solicitada tu visita.",
    appointmentAlert: { advisorPhone: PRINCIPAL, advisorName: "Daiana Zea", advisorId: "adv-daiana", advisorAlert: "📅 Nueva cita PROPUESTA" },
    assistantMessageId: null,
  }));
  // La respuesta al cliente sale por Graph directo: se acepta sin mas.
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.SALE" }] }) }));
  t.mock.method(advisors, "listElegibles", async () => []);
  t.mock.method(advisors, "findByPhone", async (orgId, tel) =>
    tel === RESPALDO ? { id: "adv-daiana-2", name: "Daiana Zea (línea 2)", phone: RESPALDO, activo: true } : null
  );
  const avisos = [];
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async (org, tel, texto) => {
    avisos.push({ tel, texto });
    return resultadoPorTelefono[tel] || { ok: true, wamid: `wm-${tel}` };
  });
  const previo = process.env.RADAR_ESCALADO_PHONE;
  process.env.RADAR_ESCALADO_PHONE = RESPALDO;
  t.after(() => {
    if (previo === undefined) delete process.env.RADAR_ESCALADO_PHONE;
    else process.env.RADAR_ESCALADO_PHONE = previo;
  });
  return { avisos };
}

test("ventana de la coordinadora cerrada: el aviso de cita pasa al numero de respaldo", async (t) => {
  const { avisos } = preparar(t, { [PRINCIPAL]: { ok: false, error: CERRADA } });
  await entregar(webhookMeta("wamid.CITA1"));

  assert.deepStrictEqual(avisos.map((a) => a.tel), [PRINCIPAL, RESPALDO], "primero el principal, luego el respaldo");
  assert.match(avisos[1].texto, /Nueva cita PROPUESTA/, "el aviso original va completo");
});

test("con la ventana abierta, el aviso de cita sale solo al principal", async (t) => {
  const { avisos } = preparar(t, {});
  await entregar(webhookMeta("wamid.CITA2"));

  assert.deepStrictEqual(avisos.map((a) => a.tel), [PRINCIPAL]);
});
