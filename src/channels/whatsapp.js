const express = require("express");
const config = require("../config");
const organizations = require("../data/organizations");
const conversations = require("../data/conversations");
const supabase = require("../data/supabase");
const { procesarMensaje } = require("../agent/engine");
const { verifyMetaSignature } = require("../lib/signature");
const { enqueue } = require("../lib/user-queue");

const router = express.Router();
let warnedNoAppSecret = false;

// overridePhoneId: phone_number_id explicito (el numero por el que entro la
// conversacion) — tiene prioridad sobre el numero por defecto de la org, para
// que la respuesta salga siempre por el mismo numero que recibio el mensaje.
function credsFor(org, overridePhoneId) {
  const token = org.whatsapp_token || config.whatsapp.token;
  const phoneId = overridePhoneId || (org.whatsapp_phone_id !== "DEMO_PHONE_ID" ? org.whatsapp_phone_id : config.whatsapp.phoneId);
  return { token, phoneId };
}

const SEND_TIMEOUT_MS = 15000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// POST comun a /messages con timeout + 1 reintento con backoff corto ante
// error de red o 5xx (un 4xx — ej. numero invalido, plantilla no aprobada —
// no se reintenta, es un fallo permanente). Devuelve SIEMPRE {ok, wamid,
// error} en vez de wamid|null: antes un fallo se veia identico a un exito
// para quien llamaba (el CRM mostraba como "enviado" un mensaje que Meta
// jamas entrego). Ver conversations.setDelivery.
async function graphSendMessage(phoneId, token, body, label) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true, wamid: json.messages?.[0]?.id || null, error: null };
      lastError = json?.error?.message || `http_${res.status}`;
      console.error(`[whatsapp] Error enviando ${label} (intento ${attempt}):`, res.status, JSON.stringify(json));
      if (res.status < 500 || attempt === 2) return { ok: false, wamid: null, error: lastError };
    } catch (e) {
      lastError = e.name === "TimeoutError" || e.name === "AbortError" ? "timeout" : e.message;
      console.error(`[whatsapp] Error de red enviando ${label} (intento ${attempt}):`, lastError);
      if (attempt === 2) return { ok: false, wamid: null, error: lastError };
    }
    await sleep(500 * attempt); // backoff corto antes del reintento
  }
  return { ok: false, wamid: null, error: lastError };
}

// Envia texto. opts.contextWaId: wamid del mensaje que se esta respondiendo (cita).
// opts.fromPhoneId: numero de origen explicito (ver credsFor).
// Devuelve {ok, wamid, error}.
async function sendWhatsApp(org, to, text, opts = {}) {
  const { token, phoneId } = credsFor(org, opts.fromPhoneId);
  if (!token || !phoneId) {
    console.warn("[whatsapp] Sin token/phoneId configurado — mensaje no enviado:", text.slice(0, 80));
    return { ok: false, wamid: null, error: "sin_credenciales" };
  }
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };
  if (opts.contextWaId) body.context = { message_id: opts.contextWaId };
  return graphSendMessage(phoneId, token, body, "mensaje");
}

// Envia una PLANTILLA aprobada de WhatsApp (HSM) — unica forma de escribirle
// a alguien fuera de la ventana de 24h (ej. recordatorios proactivos al
// asesor). bodyParams son los valores de {{1}}..{{n}} del cuerpo, en orden.
// Devuelve {ok, wamid, error} (error si la plantilla aun no esta aprobada).
async function sendWhatsAppTemplate(org, to, { name, language = "es", bodyParams = [], fromPhoneId } = {}) {
  const { token, phoneId } = credsFor(org, fromPhoneId);
  if (!token || !phoneId) {
    console.warn("[whatsapp] Sin token/phoneId — plantilla no enviada:", name);
    return { ok: false, wamid: null, error: "sin_credenciales" };
  }
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name,
      language: { code: language },
      ...(bodyParams.length
        ? { components: [{ type: "body", parameters: bodyParams.map((t) => ({ type: "text", text: String(t) })) }] }
        : {}),
    },
  };
  return graphSendMessage(phoneId, token, body, `plantilla ${name}`);
}

// Sube un archivo a Meta y devuelve el media_id
async function uploadMediaToMeta(org, buffer, mime, filename = "archivo", fromPhoneId) {
  const { token, phoneId } = credsFor(org, fromPhoneId);
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", new Blob([buffer], { type: mime }), filename);
  const res = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Meta media upload: ${res.status} ${JSON.stringify(json)}`);
  return json.id;
}

// Envia un mensaje multimedia (image | audio | document). Devuelve wamid.
async function sendWhatsAppMedia(org, to, { type, mediaId, caption, contextWaId, filename, fromPhoneId }) {
  const { token, phoneId } = credsFor(org, fromPhoneId);
  const media = { id: mediaId };
  if (caption && type === "image") media.caption = caption;
  if (type === "document" && filename) media.filename = filename;
  const body = { messaging_product: "whatsapp", to, type, [type]: media };
  if (contextWaId) body.context = { message_id: contextWaId };
  const res = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Meta media send: ${res.status} ${JSON.stringify(json)}`);
  return json.messages?.[0]?.id || null;
}

// Descarga el contenido de un media entrante de Meta y lo publica en Supabase Storage.
// Devuelve { url, mime } o null.
async function persistIncomingMedia(org, mediaId) {
  if (!supabase || !mediaId) return null;
  const { token } = credsFor(org);
  try {
    const meta = await (await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    if (!meta.url) return null;
    const bin = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
    const buffer = Buffer.from(await bin.arrayBuffer());
    const mime = meta.mime_type || "application/octet-stream";
    const ext = (mime.split("/")[1] || "bin").split(";")[0];
    const path = `in/${mediaId}.${ext}`;
    const { error } = await supabase.storage.from("media").upload(path, buffer, {
      contentType: mime,
      upsert: true,
    });
    if (error) throw error;
    const { data } = supabase.storage.from("media").getPublicUrl(path);
    return { url: data.publicUrl, mime };
  } catch (e) {
    console.error("[whatsapp] Error persistiendo media entrante:", e.message);
    return null;
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
  // Sin esta verificacion cualquiera con la URL del webhook (publica en
  // Railway) puede inyectar mensajes falsos y hacer que Sofi le escriba a
  // cualquier numero desde el WhatsApp real de la org. Si META_APP_SECRET no
  // esta configurado se deja pasar (dev/staging) con un warn una sola vez.
  if (config.metaAppSecret) {
    const valid = verifyMetaSignature(req.rawBody, req.headers["x-hub-signature-256"], config.metaAppSecret);
    if (!valid) {
      console.error("[whatsapp] Firma invalida en webhook — rechazado");
      return res.sendStatus(403);
    }
  } else if (!warnedNoAppSecret) {
    warnedNoAppSecret = true;
    console.warn("[whatsapp] META_APP_SECRET no configurado — webhook sin verificar firma");
  }

  res.sendStatus(200); // responder rapido; procesar async

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (value?.statuses) return; // ignorar acuses de entrega/lectura
    const message = value?.messages?.[0];
    if (!message) return;

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

    // Serializa TODO el procesamiento de este cliente (incluye el envio de
    // la respuesta): sin esto, 2-3 mensajes seguidos del mismo numero
    // (patron normal de un chat real) disparan procesarMensaje en paralelo
    // — el segundo insert de lead/conversacion choca con el otro, y dos
    // llamadas a Claude con historiales desincronizados producen doble
    // respuesta o silencio. Keys distintas (otros clientes) no se bloquean
    // entre si. Ver src/lib/user-queue.js.
    await enqueue(`${org.id}:${userPhone}`, async () => {
      // Respuesta citada: Meta manda context.id (wamid del mensaje citado)
      let replyToId = null;
      if (message.context?.id) {
        const ref = await conversations.findByWaMessageId(message.context.id);
        replyToId = ref?.id || null;
      }

      // Normalizar el contenido segun el tipo
      let userText = null;
      const extras = { wa_message_id: message.id, reply_to_id: replyToId };
      if (message.type === "text" && message.text?.body) {
        userText = message.text.body.trim();
      } else if (["image", "audio", "document", "video"].includes(message.type)) {
        const mediaObj = message[message.type] || {};
        const persisted = await persistIncomingMedia(org, mediaObj.id);
        extras.type = message.type;
        extras.media_url = persisted?.url || null;
        extras.media_mime = persisted?.mime || mediaObj.mime_type || null;
        userText = mediaObj.caption?.trim() ||
          (message.type === "image" ? "[Imagen recibida]" :
           message.type === "audio" ? "[Nota de voz recibida]" :
           message.type === "video" ? "[Video recibido]" : "[Documento recibido]");
      } else {
        return; // tipos no soportados (stickers, reacciones, ubicacion)
      }

      console.log(`[whatsapp][${org.name}][${userPhone}] (${message.type}) ${userText}`);

      // Presente solo en el primer mensaje de una conversacion originada en un
      // anuncio de clic-a-WhatsApp (Meta adjunta este objeto automaticamente).
      const adReferral = message.referral || null;

      const { reply, transfer, allyAlert, appointmentAlert, captadorAlert, assistantMessageId } = await procesarMensaje({
        org,
        phone: userPhone,
        text: userText,
        source: "whatsapp",
        messageExtras: extras,
        phoneNumberId,
        adReferral,
      });

      if (reply) {
        const { ok, wamid, error } = await sendWhatsApp(org, userPhone, reply, { fromPhoneId: phoneNumberId });
        if (assistantMessageId) {
          await conversations.setDelivery(assistantMessageId, ok ? "sent" : "failed", error);
          if (wamid) await conversations.setWaMessageId(assistantMessageId, wamid);
        }
      }
      if (transfer) {
        await sendWhatsApp(org, transfer.advisorPhone, transfer.advisorAlert, { fromPhoneId: phoneNumberId });
      }
      if (allyAlert) {
        await sendWhatsApp(org, allyAlert.advisorPhone, allyAlert.advisorAlert, { fromPhoneId: phoneNumberId });
      }
      if (appointmentAlert) {
        await sendWhatsApp(org, appointmentAlert.advisorPhone, appointmentAlert.advisorAlert, { fromPhoneId: phoneNumberId });
      }
      if (captadorAlert) {
        await sendWhatsApp(org, captadorAlert.advisorPhone, captadorAlert.advisorAlert, { fromPhoneId: phoneNumberId });
      }
    });
  } catch (e) {
    console.error("[whatsapp] Error procesando webhook:", e);
  }
});

module.exports = router;
module.exports.sendWhatsApp = sendWhatsApp;
module.exports.sendWhatsAppTemplate = sendWhatsAppTemplate;
module.exports.uploadMediaToMeta = uploadMediaToMeta;
module.exports.sendWhatsAppMedia = sendWhatsAppMedia;
