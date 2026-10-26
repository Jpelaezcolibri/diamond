// Deja en la conversacion del chat lo que el sistema le mando al colega o cliente
// (mismo patron que scheduler/visita-cliente.js): el CRM lo muestra y Sofi lo ve
// en el historial del siguiente turno. Quien llama lo envuelve en un catch: si
// guardar falla, el envio ya salio y no se deshace.
async function registrarSaliente(org, lead, texto, wamid = null) {
  const conversations = require("../data/conversations");
  const conv = await conversations.findOrCreate(org.id, lead.id);
  const msg = await conversations.appendMessage(conv.id, "assistant", texto, wamid ? { wa_message_id: wamid } : {});
  if (msg && msg.id) await conversations.setDelivery(msg.id, "sent");
  return msg;
}

module.exports = { registrarSaliente };
