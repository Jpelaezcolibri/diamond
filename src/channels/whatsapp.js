const express = require("express");
const config = require("../config");
const organizations = require("../data/organizations");
const conversations = require("../data/conversations");
const groupSignals = require("../data/group-signals");
const supabase = require("../data/supabase");
const leads = require("../data/leads");
const advisors = require("../data/advisors");
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

// Botones de respuesta rapida (Juan, 2026-08-21 — "se esta enredando con las
// respuestas y estamos perdiendo es plata"): el aviso "Tenes un match del
// radar" le pedia a la asesora escribir "si"/"no" en texto libre, que Sofi
// tenia que interpretar en medio de una conversacion con otros temas — con
// varios pedidos pendientes a la vez, ambiguo hasta para una persona. Un boton
// no se interpreta: trae el id de la señal adentro (ver
// src/groups/vivo.js#avisarCercano), asi que el webhook puede resolver la
// accion en el acto sin pasar por el modelo. Maximo 3 botones, titulo <=20
// caracteres, cuerpo <=1024 — limites duros de la API de Meta.
// buttons: [{id, title}]. Devuelve {ok, wamid, error}.
async function sendWhatsAppButtons(org, to, body, buttons, opts = {}) {
  const { token, phoneId } = credsFor(org, opts.fromPhoneId);
  if (!token || !phoneId) {
    console.warn("[whatsapp] Sin token/phoneId configurado — botones no enviados:", body.slice(0, 80));
    return { ok: false, wamid: null, error: "sin_credenciales" };
  }
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: { buttons: buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })) },
    },
  };
  if (opts.contextWaId) payload.context = { message_id: opts.contextWaId };
  return graphSendMessage(phoneId, token, payload, "botones");
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

// Resuelve el toque de un boton "Sí, publicar" / "No sirve" del aviso VIEJO
// del radar (ver src/groups/vivo.js#avisarCercano). El id del boton ES la
// señal: "radar_si:<uuid>" / "radar_no:<uuid>".
//
// CAMBIO DE POLITICA (Juan, 2026-08-22): el radar ya no publica nada en los
// grupos, ni con aprobacion — norma del gremio de no llenarlos de
// informacion. El boton "Sí, publicar" se saco de los avisos NUEVOS (ver
// vivo.js#avisarCercano), pero los avisos YA ENTREGADOS antes del cambio
// conservan ese boton vivo en el WhatsApp de la asesora: un toque en un
// mensaje viejo sigue llegando a este webhook. Por eso "radar_si" ya NO llama
// a tools.aprobarPedidoRadar (que sigue existiendo intacto — es el camino de
// aprobarManual desde el CRM, una accion deliberada y distinta) y en vez de
// publicar le avisa que esa opcion ya no existe. "radar_no" no cambia: sigue
// registrando el descarte con rechazarPedidoRadar, igual que siempre.
async function procesarBotonRadar(org, userPhone, botonId, tituloBoton, phoneNumberId) {
  const separador = String(botonId).indexOf(":");
  const accion = separador === -1 ? botonId : botonId.slice(0, separador);
  const signalId = separador === -1 ? null : botonId.slice(separador + 1);
  if ((accion !== "radar_si" && accion !== "radar_no") || !signalId) {
    console.warn(`[whatsapp] Boton desconocido: "${botonId}"`);
    return;
  }

  const advisor = await advisors.findByPhone(org.id, userPhone).catch(() => null);
  if (!advisor) {
    console.warn(`[whatsapp] Boton del radar desde un numero que no es asesor: ${userPhone}`);
    return;
  }

  // Se deja registrado el toque en si (no solo la confirmacion) para que el
  // Inbox del panel "Equipo" del CRM muestre la conversacion completa.
  const lead = await leads.findOrCreate(org.id, userPhone, "asesor");
  const conv = await conversations.findOrCreate(org.id, lead.id, null);
  await conversations.appendMessage(conv.id, "user", `[Botón] ${tituloBoton || accion}`).catch(() => {});

  let respuesta;
  if (accion === "radar_si") {
    // Boton retirado (2026-08-22): si esto se dispara es por un aviso viejo
    // ya entregado antes del cambio de norma. No se publica nada — se le dice
    // a la asesora la accion que sigue viva.
    respuesta = "Esa opción ya no está disponible: el radar dejó de publicar en los grupos (norma del gremio). Respondele al colega por privado con lo que te mandó el aviso, y contame por acá en qué quedó.";
  } else {
    // Require tardio (mismo motivo que src/agent/tools.js#aprobarPedidoRadar):
    // este archivo -> engine.js -> tools.js -> (lazy) vivo.js -> este archivo.
    const tools = require("../agent/tools");
    respuesta = await tools.rechazarPedidoRadar({}, { org, advisor, radarSignalId: signalId });
  }

  const mensajeAsesor = require("../lib/mensaje-asesor");
  await mensajeAsesor.enviarYRegistrar(org, userPhone, respuesta).catch((e) =>
    console.error(`[whatsapp] No se pudo confirmar la accion del boton a ${userPhone}:`, e.message)
  );
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
    // ACUSES (Juan, 2026-09-02, hallazgo #4). Hasta hoy se descartaban: "enviado"
    // significaba que Meta acepto el POST y nada mas. Con esto pasa a
    // "entregado" o "leido" cuando WhatsApp lo confirma, y a "fallido" con el
    // motivo cuando lo rechaza despues (ventana cerrada, numero invalido). Es
    // lo que convierte la alarma de ventana cerrada en un dato en vez de una
    // inferencia. Best-effort: un acuse que no se pudo guardar no es noticia.
    if (value?.statuses) {
      await registrarAcuses(value.statuses).catch((e) => console.warn("[whatsapp] acuses:", e.message));
      return;
    }
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
      // BOTON DEL RADAR (Juan, 2026-08-21): un toque en "Sí, publicar" / "No
      // sirve" llega como type=interactive, con el id de la señal ya adentro
      // del boton (ver src/groups/vivo.js#avisarCercano) — se resuelve ACA,
      // antes de tocar procesarMensaje/Claude. Nunca hay que desambiguar cual
      // pedido ni depender de que el modelo interprete un "si"/"no" suelto en
      // medio de otra conversacion — la causa real de "se enreda con las
      // respuestas" cuando hay mas de un pedido pendiente a la vez.
      const botonId = message.type === "interactive" && message.interactive?.type === "button_reply"
        ? message.interactive.button_reply?.id
        : null;
      if (botonId) {
        await procesarBotonRadar(org, userPhone, botonId, message.interactive.button_reply?.title, phoneNumberId);
        return;
      }

      // Respuesta citada: Meta manda context.id (wamid del mensaje citado)
      let replyToId = null;
      // Si la asesora cita (swipe-to-reply) el aviso de un pedido del radar,
      // esto resuelve DIRECTO a esa señal — Sofi no tiene que preguntar a
      // cual pedido se refiere ni adivinarlo. Ver registrar_resultado_radar.
      let radarSignalId = null;
      if (message.context?.id) {
        const ref = await conversations.findByWaMessageId(message.context.id);
        replyToId = ref?.id || null;
        if (!replyToId) {
          const señal = await groupSignals.findByWamid(org.id, message.context.id).catch(() => null);
          radarSignalId = señal?.id || null;
        }
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
        radarSignalId,
      });

      if (reply) {
        const { ok, wamid, error } = await sendWhatsApp(org, userPhone, reply, { fromPhoneId: phoneNumberId });
        if (assistantMessageId) {
          await conversations.setDelivery(assistantMessageId, ok ? "sent" : "failed", error);
          if (wamid) await conversations.setWaMessageId(assistantMessageId, wamid);
        }
      }
      // BUG real (Juan, 2026-08-20): "necesito confirmar si la transferencia a
      // Catherine si se hizo por que no veo registro entre Sofi y Catherine".
      // Los cuatro avisos de abajo tiraban el resultado de sendWhatsApp —
      // {ok, error}, que graphSendMessage YA calcula (ver el comentario de esa
      // funcion mas arriba) — y no lo hacian nada con el. Un fallo de Meta (el
      // caso mas probable: texto libre fuera de la ventana de 24h, que Meta
      // rechaza) quedaba solo en un console.error de Railway, invisible desde
      // el CRM: se veia identico a un exito para cualquiera mirando la
      // conversacion. Ahora un fallo se loguea CON contexto (a quien, que
      // telefono, que error) y, para transfer -el caso que Juan reporto-,
      // ademas queda una nota EN LA MISMA conversacion que ya se esta mirando.
      if (transfer) {
        const r = await sendWhatsApp(org, transfer.advisorPhone, transfer.advisorAlert, { fromPhoneId: phoneNumberId });
        if (!r.ok) {
          console.error(`[whatsapp] Aviso de transferencia a ${transfer.advisorName} (${transfer.advisorPhone}) NO se pudo enviar:`, r.error);
          if (transfer.conversationId) {
            await conversations
              .appendMessage(transfer.conversationId, "system", `⚠️ El aviso de transferencia a ${transfer.advisorName} no se pudo enviar (${r.error || "error desconocido"}). Avisale por otra via.`)
              .catch((e) => console.warn("[whatsapp] No se pudo dejar la nota del fallo:", e.message));
          }
        }
      }
      if (allyAlert) {
        const r = await sendWhatsApp(org, allyAlert.advisorPhone, allyAlert.advisorAlert, { fromPhoneId: phoneNumberId });
        if (!r.ok) console.error(`[whatsapp] Aviso de match de aliado a ${allyAlert.advisorPhone} NO se pudo enviar:`, r.error);
      }
      if (appointmentAlert) {
        const r = await sendWhatsApp(org, appointmentAlert.advisorPhone, appointmentAlert.advisorAlert, { fromPhoneId: phoneNumberId });
        if (!r.ok) console.error(`[whatsapp] Aviso de cita a ${appointmentAlert.advisorPhone} NO se pudo enviar:`, r.error);
      }
      if (captadorAlert) {
        const r = await sendWhatsApp(org, captadorAlert.advisorPhone, captadorAlert.advisorAlert, { fromPhoneId: phoneNumberId });
        if (!r.ok) console.error(`[whatsapp] Aviso de captador a ${captadorAlert.advisorPhone} NO se pudo enviar:`, r.error);
      }
    });
  } catch (e) {
    console.error("[whatsapp] Error procesando webhook:", e);
  }
});

// Cada acuse trae el wamid del mensaje, el estado y, si fallo, el error.
async function registrarAcuses(statuses) {
  let guardados = 0;
  for (const s of Array.isArray(statuses) ? statuses : []) {
    if (!s || !s.id || !s.status) continue;
    const e0 = Array.isArray(s.errors) && s.errors[0] ? s.errors[0] : null;
    const err = e0 ? `(#${e0.code}) ${e0.title || e0.message || ""}`.trim() : null;
    if (await conversations.setDeliveryPorWamid(s.id, s.status, err)) guardados++;
  }
  return guardados;
}

module.exports = router;
module.exports.sendWhatsApp = sendWhatsApp;
module.exports.sendWhatsAppButtons = sendWhatsAppButtons;
module.exports.sendWhatsAppTemplate = sendWhatsAppTemplate;
module.exports.uploadMediaToMeta = uploadMediaToMeta;
module.exports.sendWhatsAppMedia = sendWhatsAppMedia;
module.exports.procesarBotonRadar = procesarBotonRadar;
module.exports.registrarAcuses = registrarAcuses;
