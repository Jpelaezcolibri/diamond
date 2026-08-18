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

/**
 * @param org       organizacion resuelta
 * @param telefono  numero del asesor, solo digitos
 * @param texto     el mensaje a mandar
 * @returns { ok, wamid, error } — mismo shape que canalWhatsapp.sendWhatsApp
 */
async function enviarYRegistrar(org, telefono, texto) {
  const lead = await leads.findOrCreate(org.id, telefono, "asesor");
  const conv = await conversations.findOrCreate(org.id, lead.id, null);
  // Se guarda ANTES de mandar: si el envio revienta antes de responder (timeout,
  // red caida), el mensaje que se INTENTO mandar sigue siendo mas util que nada
  // — es lo mismo que ya hace src/agent/engine.js con la respuesta del cliente.
  const msg = await conversations.appendMessage(conv.id, "assistant", texto);

  const envio = await canalWhatsapp.sendWhatsApp(org, telefono, texto).catch((e) => ({ ok: false, error: e.message }));
  if (msg?.id) {
    await conversations.setDelivery(msg.id, envio && envio.ok ? "sent" : "failed", envio && envio.error);
    if (envio && envio.wamid) await conversations.setWaMessageId(msg.id, envio.wamid);
  }
  return envio || { ok: false, wamid: null, error: "sin_respuesta" };
}

module.exports = { enviarYRegistrar };
