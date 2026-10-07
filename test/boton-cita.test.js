// Botones de la plantilla cita_por_confirmar (2026-10-07): el payload viaja en
// la plantilla y vuelve en el webhook como message.button.payload.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const wa = require("../src/channels/whatsapp");

test("botonDeMensaje lee el botón interactivo y el de plantilla", () => {
  assert.strictEqual(wa.botonDeMensaje({ type: "interactive", interactive: { type: "button_reply", button_reply: { id: "radar_si:s1" } } }), "radar_si:s1");
  assert.strictEqual(wa.botonDeMensaje({ type: "button", button: { payload: "cita:l1:confirmar", text: "Confirmar" } }), "cita:l1:confirmar");
  assert.strictEqual(wa.botonDeMensaje({ type: "text", text: { body: "hola" } }), null);
  assert.strictEqual(wa.botonDeMensaje(null), null);
});

test("el webhook manda los botones cita: a confirmar-cita", () => {
  const fuente = fs.readFileSync(path.join(__dirname, "..", "src", "channels", "whatsapp.js"), "utf8");
  assert.match(fuente, /startsWith\("cita:"\)/);
  assert.match(fuente, /procesarBotonCita\(/);
});

test("sendWhatsAppTemplate arma los quick replies con su payload", async (t) => {
  let cuerpo = null;
  t.mock.method(global, "fetch", async (_url, opts) => {
    cuerpo = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ messages: [{ id: "wamid.1" }] }) };
  });
  const r = await wa.sendWhatsAppTemplate({ whatsapp_token: "t", whatsapp_phone_id: "p" }, "573001112233", {
    name: "cita_por_confirmar",
    bodyParams: ["1", "2", "3", "4"],
    buttonPayloads: ["cita:l1:confirmar", "cita:l1:otro"],
  });
  assert.strictEqual(r.ok, true);
  const botones = cuerpo.template.components.filter((c) => c.type === "button");
  assert.deepStrictEqual(botones, [
    { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: "cita:l1:confirmar" }] },
    { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: "cita:l1:otro" }] },
  ]);
  assert.strictEqual(cuerpo.template.components[0].type, "body");
});

test("sin botones ni parámetros la plantilla sale igual que antes", async (t) => {
  let cuerpo = null;
  t.mock.method(global, "fetch", async (_url, opts) => {
    cuerpo = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ messages: [{ id: "wamid.2" }] }) };
  });
  await wa.sendWhatsAppTemplate({ whatsapp_token: "t", whatsapp_phone_id: "p" }, "573001112233", { name: "hello_world" });
  assert.strictEqual(cuerpo.template.components, undefined);
});
