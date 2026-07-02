const express = require("express");
const config = require("../config");
const organizations = require("../data/organizations");
const { procesarMensaje } = require("../agent/engine");

const router = express.Router();

async function sendWhatsApp(org, to, text) {
  const token = org.whatsapp_token || config.whatsapp.token;
  const phoneId = org.whatsapp_phone_id !== "DEMO_PHONE_ID" ? org.whatsapp_phone_id : config.whatsapp.phoneId;
  if (!token || !phoneId) {
    console.warn("[whatsapp] Sin token/phoneId configurado — mensaje no enviado:", text.slice(0, 80));
    return;
  }
  const res = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });
  if (!res.ok) {
    console.error("[whatsapp] Error enviando mensaje:", res.status, await res.text());
  }
}

// Verificacion del webhook (Meta)
router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === config.whatsapp.verifyToken) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Mensajes entrantes
router.post("/webhook", async (req, res) => {
  res.sendStatus(200); // responder rapido; procesar async

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (value?.statuses) return; // ignorar acuses de entrega/lectura
    const message = value?.messages?.[0];
    if (!message || message.type !== "text" || !message.text?.body) return;

    // Multi-tenant: el phone_number_id que recibio el mensaje identifica la org
    const phoneNumberId = value?.metadata?.phone_number_id;
    const org =
      (phoneNumberId && (await organizations.findByWhatsappPhoneId(phoneNumberId))) ||
      (await organizations.getDefault());
    if (!org) {
      console.error("[whatsapp] Sin organizacion para phone_number_id:", phoneNumberId);
      return;
    }

    const userPhone = message.from;
    const userText = message.text.body.trim();
    console.log(`[whatsapp][${org.name}][${userPhone}] ${userText}`);

    const { reply, transfer } = await procesarMensaje({
      org,
      phone: userPhone,
      text: userText,
      source: "whatsapp",
    });

    await sendWhatsApp(org, userPhone, reply);
    if (transfer) {
      await sendWhatsApp(org, transfer.advisorPhone, transfer.advisorAlert);
    }
  } catch (e) {
    console.error("[whatsapp] Error procesando webhook:", e);
  }
});

module.exports = router;
