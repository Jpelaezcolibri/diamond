// EL AVISO DE UNA CITA NO SE PUEDE PERDER (Juan, 2026-09-11) — Y VA POR LA
// CAMPANA DEL CRM (Juan, 2026-10-21).
//
// Caso real 2026-09-11: la visita de Sebastian Velasquez se aviso con un
// sendWhatsApp directo a una asesora con la ventana cerrada hacia 142 h, y se
// perdio. Hasta 2026-10-21 la salida era entregarConRespaldo (texto libre con
// los datos del cliente, y si la ventana estaba cerrada, al numero de
// respaldo). Ahora la cita fuera de la rotacion (la de un colega, o sin ciclo
// de citas) va por avisarAsesor: campana + push con link al chat y, por
// WhatsApp, solo la plantilla aviso_app, que no depende de la ventana. Si no
// hay asesora con usuario a quien avisar, Juan recibe una alerta tecnica.
//
// Se mete un body de webhook de Meta por el handler real del router (mismo
// patron que test/whatsapp-usuario-sin-telefono.test.js).

const { test } = require("node:test");
const assert = require("node:assert");

const config = require("../src/config");
config.metaAppSecret = null;

const organizations = require("../src/data/organizations");
const engine = require("../src/agent/engine");
const mensajeAsesor = require("../src/lib/mensaje-asesor");
const avisar = require("../src/notifications/avisar-asesor");
const alertaSaldo = require("../src/lib/alerta-saldo");
const router = require("../src/channels/whatsapp");

const ORG = { id: "org-1", name: "Diamond", whatsapp_token: "tok", whatsapp_phone_id: "PID" };
const PRINCIPAL = "573011880668";
const DAIANA = { id: "adv-daiana", name: "Daiana Zea", phone: PRINCIPAL, activo: true };

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
  await new Promise((r) => setTimeout(r, 50));
}

function preparar(t, appointmentAlert) {
  t.mock.method(organizations, "findByWhatsappPhoneId", async () => ORG);
  t.mock.method(organizations, "getDefault", async () => ORG);
  t.mock.method(engine, "procesarMensaje", async () => ({
    reply: "Quedó solicitada tu visita.",
    lead: { id: "lead-1", nombre: "Sebastian" },
    appointmentAlert,
    assistantMessageId: null,
  }));
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.SALE" }] }) }));
  const textosLibres = [];
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async (org, tel, texto) => {
    textosLibres.push({ tel, texto });
    return { ok: true };
  });
  const campanas = [];
  t.mock.method(avisar, "avisarAsesor", async (args) => {
    campanas.push(args);
    return args.advisor && args.advisor.id ? { ok: true, whatsapp: true } : { ok: false, error: "sin asesora con usuario" };
  });
  const alertas = [];
  t.mock.method(alertaSaldo, "enviarAlertaTecnica", async (resumen, detalle) => {
    alertas.push(`${resumen} ${detalle}`);
  });
  return { textosLibres, campanas, alertas };
}

test("la cita fuera de la rotacion va por la campana del CRM, con el detalle adentro y sin texto libre", async (t) => {
  const { textosLibres, campanas, alertas } = preparar(t, {
    advisor: DAIANA,
    advisorPhone: PRINCIPAL,
    advisorName: DAIANA.name,
    advisorId: DAIANA.id,
    advisorAlert: "📅 Nueva cita PROPUESTA · Sebastian +573023980359",
  });
  await entregar(webhookMeta("wamid.CITA1"));

  assert.strictEqual(campanas.length, 1);
  assert.strictEqual(campanas[0].advisor.id, DAIANA.id);
  assert.strictEqual(campanas[0].motivo, "visita");
  assert.match(campanas[0].cuerpo, /Nueva cita PROPUESTA/, "el detalle queda en la campana (dentro del CRM)");
  assert.strictEqual(textosLibres.length, 0, "nada sale como texto libre con datos del cliente");
  assert.strictEqual(alertas.length, 0);
});

test("cita sin asesora con usuario: alerta tecnica a Juan, sin el telefono del cliente", async (t) => {
  const { textosLibres, alertas } = preparar(t, {
    advisorPhone: "573000000000",
    advisorName: "Asesor",
    advisorId: null,
    advisorAlert: "📅 Nueva cita PROPUESTA · +573023980359",
  });
  await entregar(webhookMeta("wamid.CITA2"));

  assert.strictEqual(textosLibres.length, 0);
  assert.strictEqual(alertas.length, 1);
  assert.match(alertas[0], /lead-1/);
  assert.doesNotMatch(alertas[0], /3023980359/);
});
