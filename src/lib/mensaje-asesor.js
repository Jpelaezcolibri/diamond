// Manda un WhatsApp a un asesor Y lo deja guardado como mensaje real, con el
// mismo mecanismo que usa el chat normal (leads + conversations + messages).
//
// POR QUE EXISTE. Hasta el 2026-08-18, los avisos del radar (src/groups/vivo.js)
// y los mensajes de Sofi-Comando (enviar_whatsapp_equipo) se mandaban con
// canalWhatsapp.sendWhatsApp DIRECTO — sin pasar por el sistema de
// conversaciones. Salian y se olvidaban: no quedaba ningun registro mas alla
// de "algo se envio". Juan lo encontro pidiendo ver, en el Inbox, la prueba
// tecnica que se le habia mandado a Catherine y el intento de reenvio de
// Sofi — y no estaban en ningun lado, porque nunca se habian guardado.
//
// Con esto, CUALQUIER mensaje que Sofi le mande a un asesor —radar,
// Sofi-Comando, recordatorios— queda en la misma conversacion que ya usa el
// chat normal, visible como cualquier otro hilo (ver el panel "Equipo" del
// CRM, que filtra por leads.source = "asesor").
const leads = require("../data/leads");
const conversations = require("../data/conversations");
// Modulo y no funcion suelta: destructurar congela la referencia y deja los
// tests sin forma de mockear el envio (mismo criterio que src/groups/vivo.js).
const canalWhatsapp = require("../channels/whatsapp");

// ALERTA DE ENVIO FALLIDO (Juan, 2026-08-21 — caso Natalia/radar: 7 avisos
// seguidos quedaron en `delivery: sent` porque Meta acepta el POST y nosotros
// IGNORAMOS a proposito los acuses de entrega/lectura que llegan despues por
// webhook (ver src/channels/whatsapp.js, `if (value?.statuses) return`). Un
// mensaje que Meta rechaza silenciosamente mas tarde, o que nunca llega
// porque la ventana de 24h con ESE numero esta cerrada, se veia igual que uno
// que si llego — hasta que el asesor decia "a mi no me llego nada".
//
// Esto no arregla el hueco de fondo (seguimos sin leer los `statuses`), pero
// cierra el caso mas comun y mas detectable: la Graph API SI devuelve un
// error sincronico cuando la ventana esta cerrada (via ese numero no escribio
// en las ultimas 24h). Reusa RADAR_WATCHDOG_TO — el mismo numero de Juan que
// ya usa src/scheduler/radar-watchdog.js para todo lo demas que falla
// silencioso en este ecosistema.
const ADMIN_ALERTA_TO = (process.env.RADAR_WATCHDOG_TO || "").split(",").map((t) => t.trim()).filter(Boolean);
const VENTANA_CERRADA = /24\s*hours?|24\s*horas?|re-?engagement|131047/i;

async function avisarFalloEnvio(org, telefono, texto, error) {
  if (ADMIN_ALERTA_TO.length === 0) return;
  const motivo = VENTANA_CERRADA.test(error || "")
    ? "la ventana de 24h con ese numero esta cerrada (no te escribio en las ultimas 24h, asi que WhatsApp no deja mandarle texto libre)"
    : `error: ${error || "sin detalle"}`;
  const recorte = texto.length > 200 ? `${texto.slice(0, 200)}...` : texto;
  const aviso = `⚠️ No se pudo mandar un WhatsApp a +${telefono}: ${motivo}.\n\nMensaje que no salio:\n"${recorte}"`;
  for (const to of ADMIN_ALERTA_TO) {
    if (to === telefono) continue; // no alertar al mismo numero que ya fallo
    const r = await canalWhatsapp.sendWhatsApp(org, to, aviso).catch((e) => ({ ok: false, error: e.message }));
    if (!r || !r.ok) console.error(`[mensaje-asesor] tampoco se pudo avisar del fallo a ${to}: ${r && r.error}`);
  }
}

/**
 * @param org       organizacion resuelta
 * @param telefono  numero del asesor, solo digitos
 * @param texto     el mensaje a mandar (o el cuerpo, si va con botones)
 * @param opts.botones  [{id, title}] — si vienen, se manda como mensaje
 *   interactivo (ver canalWhatsapp.sendWhatsAppButtons) en vez de texto
 *   libre. El `texto` completo igual queda guardado como contenido del
 *   mensaje, para que el Inbox del CRM muestre lo mismo que via en el chat.
 * @returns { ok, wamid, error } — mismo shape que canalWhatsapp.sendWhatsApp
 */
async function enviarYRegistrar(org, telefono, texto, opts = {}) {
  const lead = await leads.findOrCreate(org.id, telefono, "asesor");
  const conv = await conversations.findOrCreate(org.id, lead.id, null);
  // Se guarda ANTES de mandar: si el envio revienta antes de responder (timeout,
  // red caida), el mensaje que se INTENTO mandar sigue siendo mas util que nada
  // — es lo mismo que ya hace src/agent/engine.js con la respuesta del cliente.
  const msg = await conversations.appendMessage(conv.id, "assistant", texto);

  const envio = opts.botones
    ? await canalWhatsapp.sendWhatsAppButtons(org, telefono, texto, opts.botones).catch((e) => ({ ok: false, error: e.message }))
    : await canalWhatsapp.sendWhatsApp(org, telefono, texto).catch((e) => ({ ok: false, error: e.message }));
  if (msg?.id) {
    await conversations.setDelivery(msg.id, envio && envio.ok ? "sent" : "failed", envio && envio.error);
    if (envio && envio.wamid) await conversations.setWaMessageId(msg.id, envio.wamid);
  }
  if (!envio || !envio.ok) await avisarFalloEnvio(org, telefono, texto, envio && envio.error);
  return envio || { ok: false, wamid: null, error: "sin_respuesta" };
}

// Se exporta VENTANA_CERRADA porque el carril de compra necesita distinguir
// "Meta rechazo por ventana cerrada" (donde la plantilla SI sirve) de cualquier
// otro fallo (donde no sirve de nada reintentar con plantilla).
module.exports = { enviarYRegistrar, VENTANA_CERRADA };
