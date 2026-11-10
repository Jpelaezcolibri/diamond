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

const digitos = (x) => String(x || "").replace(/\D/g, "");

// El numero para contactar a esta persona: el que dejo en el chat
// (leads.celular o cita.celular_contacto, ver celular-contacto.js) o el de su
// WhatsApp. Nunca el identificador "CO.…". En digitos, o null.
function celularDe(lead) {
  if (!lead) return null;
  const guardado = digitos(lead.celular) || digitos(lead.cita && lead.cita.celular_contacto);
  if (guardado) return guardado;
  if (sinCelular(lead.phone)) return null;
  const d = digitos(lead.phone);
  return d.length >= 8 ? d : null;
}

function legible(cel) {
  const d = digitos(cel);
  if (d.length === 12 && d.startsWith("57")) return `+57 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  return d ? `+${d}` : null;
}

function quienDe(lead) {
  if (!lead) return "alguien";
  const nombre = String(lead.nombre || "").trim();
  if (nombre) return nombre;
  const cel = celularDe(lead);
  if (cel && digitos(lead.celular || (lead.cita && lead.cita.celular_contacto))) return legible(cel);
  if (sinCelular(lead.phone)) return "contacto sin celular visible";
  return lead.phone ? `+${lead.phone}` : "alguien";
}

const AVISO_SIN_CELULAR = "Sin celular visible (WhatsApp lo oculta): escríbele desde su chat en el CRM y pídele un número";

module.exports = { quienDe, sinCelular, celularDe, legible, AVISO_SIN_CELULAR };
