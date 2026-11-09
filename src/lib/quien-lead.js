// Como se nombra a un cliente o colega en los avisos INTERNOS (campanas, CRM).
// Caso Norha Velez (2026-11-09): WhatsApp le oculta el celular y el lead
// quedo con el identificador "CO.1622610936270244" como telefono; los avisos
// decian "+CO.1622610936270244 (colega)", que parece un numero y no lo es.
// Nadie la llamó porque no habia a donde.

// Mismo formato que reconoce src/channels/whatsapp.js (usuario sin telefono).
const ID_DE_USUARIO = /^[A-Z]{2}\.[A-Za-z0-9.]+$/;

function sinCelular(phone) {
  return ID_DE_USUARIO.test(String(phone || "").trim());
}

function quienDe(lead) {
  if (!lead) return "alguien";
  const nombre = String(lead.nombre || "").trim();
  if (nombre) return nombre;
  if (sinCelular(lead.phone)) return "contacto sin celular visible";
  return lead.phone ? `+${lead.phone}` : "alguien";
}

const AVISO_SIN_CELULAR = "Sin celular visible (WhatsApp lo oculta): escríbele desde su chat en el CRM y pídele un número";

module.exports = { quienDe, sinCelular, AVISO_SIN_CELULAR };
