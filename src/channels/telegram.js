// Canal Telegram — usado para pruebas y demos sin depender de Meta.
// Deep link: https://t.me/<bot>?start=AP001 simula el click en una publicacion.
const express = require("express");
const config = require("../config");
const organizations = require("../data/organizations");
const { procesarMensaje } = require("../agent/engine");

const router = express.Router();
const API = () => `https://api.telegram.org/bot${config.telegramToken}`;

async function sendTelegram(chatId, text) {
  const res = await fetch(`${API()}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    console.error("[telegram] Error enviando mensaje:", res.status, await res.text());
  }
}

router.post("/telegram", async (req, res) => {
  res.sendStatus(200);

  try {
    const message = req.body?.message;
    if (!message?.text) return;

    const chatId = String(message.chat.id);
    let userText = message.text.trim();

    // /start AP001 → simula que el usuario llego desde la publicacion de esa ref
    if (userText.startsWith("/start")) {
      const ref = userText.replace("/start", "").trim();
      userText = ref ? `Hola, me interesa la propiedad ${ref}` : "Hola";
    }

    const org = await organizations.getDefault();
    console.log(`[telegram][${chatId}] ${userText}`);

    const { reply, transfer } = await procesarMensaje({
      org,
      phone: chatId,
      text: userText,
      source: "telegram",
    });

    if (reply) await sendTelegram(chatId, reply);
    if (transfer) {
      // En demo la alerta se envia al mismo chat, marcada, para que se vea el flujo
      await sendTelegram(chatId, `🔔 [ALERTA QUE RECIBE EL ASESOR]\n\n${transfer.advisorAlert}`);
    }
  } catch (e) {
    console.error("[telegram] Error procesando update:", e);
  }
});

module.exports = router;
