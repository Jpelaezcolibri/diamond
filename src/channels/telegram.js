// Canal Telegram — usado para pruebas y demos sin depender de Meta.
// Deep link: https://t.me/<bot>?start=AP001 simula el click en una publicacion.
const express = require("express");
const config = require("../config");
const organizations = require("../data/organizations");
const { procesarMensaje } = require("../agent/engine");
const { enqueue } = require("../lib/user-queue");

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
  // Sin validar el secret_token cualquiera con la URL puede simular mensajes
  // de cualquier chat_id y usar el bot como proxy de spam. Se configura al
  // registrar el webhook (setWebhook con secret_token=TELEGRAM_SECRET_TOKEN).
  if (config.telegramSecretToken) {
    const header = req.headers["x-telegram-bot-api-secret-token"];
    if (header !== config.telegramSecretToken) {
      console.error("[telegram] Secret token invalido — rechazado");
      return res.sendStatus(403);
    }
  }

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

    // Misma cola por usuario que WhatsApp (ver src/lib/user-queue.js): evita
    // respuestas dobles/desincronizadas si el mismo chat manda mensajes seguidos.
    await enqueue(`${org.id}:${chatId}`, async () => {
      const { reply, transfer, allyAlert, appointmentAlert } = await procesarMensaje({
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
      if (allyAlert) {
        await sendTelegram(chatId, `🔔 [ALERTA INMEDIATA AL DUENO DEL ALIADO]\n\n${allyAlert.advisorAlert}`);
      }
      if (appointmentAlert) {
        await sendTelegram(chatId, `🔔 [ALERTA DE CITA AGENDADA]\n\n${appointmentAlert.advisorAlert}`);
        // Las copias del aviso (Juan, 2026-09-04, para las citas de colega).
        // En demo se muestran en el mismo chat, marcadas con su destinatario,
        // igual que el resto de las alertas. Un aviso sin `copias` no entra.
        for (const copia of appointmentAlert.copias || []) {
          await sendTelegram(chatId, `🔔 [COPIA DEL AVISO DE CITA → ${copia}]\n\n${appointmentAlert.advisorAlert}`);
        }
      }
    });
  } catch (e) {
    console.error("[telegram] Error procesando update:", e);
  }
});

module.exports = router;
