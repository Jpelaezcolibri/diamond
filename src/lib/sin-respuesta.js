// Nadie queda sin contactar (Juan, 2026-10-29: "si no dan una respuesta sofi
// les debe de hacer el seguimiento y si no contesta que el asesor lo realice,
// pero no podemos quedar con posibles clientes sin contactar"). Casos: Clara
// (dos horarios ofrecidos, no escogio, nadie volvio a escribirle), Luz Stella
// (mando notas de voz que Sofi no oye) y Freddy (pidio al asesor y nadie le
// escribio en 19 h).
//
// Pura: decide si el episodio de un lead pasa a la asesora y por que. Un
// episodio arranca con el ultimo mensaje de la persona; se escala una sola vez
// por episodio (leads.seguimiento.asesor_at).
const { esAutorespuesta } = require("../groups/rechaza-bot");

const H = 60 * 60 * 1000;

const tras = (envName, def) => Number(process.env[envName] || def) * H;
const TRAS_SEGUIMIENTO = () => tras("SIN_RESPUESTA_TRAS_SEGUIMIENTO_H", 3);
const PIDE_ASESOR = () => tras("SIN_RESPUESTA_PIDE_ASESOR_H", 2);
const NOTA_DE_VOZ = () => tras("SIN_RESPUESTA_NOTA_DE_VOZ_H", 2);
// Si Sofi no alcanzo a hacer su seguimiento, a la asesora le llega cuando la
// ventana de 24 h ya se cerro (Sofi no puede escribirle texto libre) y Sofi
// lleva por lo menos este silencio. Con la ventana abierta, primero Sofi.
const SIN_SEGUIMIENTO = () => tras("SIN_RESPUESTA_SIN_SEGUIMIENTO_H", 3);
const VENTANA = 23 * H; // mismo margen que followups.ventanaAbierta
// Mas viejo que esto ya no es un episodio vivo (los atrasados se entregan en
// una lista aparte, no por este carril).
const EDAD_MAX = () => tras("SIN_RESPUESTA_EDAD_MAX_H", 48);

const ESTADOS_CERRADOS = new Set(["descartado", "cerrado_ganado", "cerrado_perdido"]);
// Lo atiende otro carril: la escalera de preguntas, la de citas o la
// transferencia (con su propia pausa y aviso).
const ATENCION_DE_OTRO = new Set(["pregunta", "visita", "transferido"]);
const NOTA_DE_VOZ_RE = /^\[Nota de voz/i;

const t = (iso) => (iso ? new Date(iso).getTime() : NaN);

/**
 * @param lead      { source, estado, atencion_pendiente, atencion_desde, seguimiento }
 * @param ultimoUsuario    { content, created_at } ultimo mensaje de la persona
 * @param ultimoMensaje    { role, created_at } ultimo mensaje del chat
 * @returns null | { motivo: "pide_asesor" | "nota_de_voz" | "no_contesto" | "sin_seguimiento" }
 */
function motivoEscalar({ lead, ultimoUsuario, ultimoMensaje, ahora = new Date() }) {
  if (!lead || !ultimoUsuario || !ultimoMensaje) return null;
  if (lead.source === "asesor" || lead.source === "test") return null;
  if (ESTADOS_CERRADOS.has(lead.estado)) return null;
  const now = ahora.getTime();
  const desdeUsuario = t(ultimoUsuario.created_at);
  if (isNaN(desdeUsuario) || now - desdeUsuario > EDAD_MAX()) return null;
  const seg = lead.seguimiento || {};
  if (t(seg.asesor_at) >= desdeUsuario) return null; // ya se escalo este episodio
  if (ATENCION_DE_OTRO.has(lead.atencion_pendiente)) return null;
  // Lo ultimo fue una respuesta automatica de otra inmobiliaria ("no nos
  // encontramos en horario de atencion"): no hay persona a quien llamar
  // (caso Propiedades Carva, 2026-10-28).
  if (esAutorespuesta(String(ultimoUsuario.content || ""))) return null;

  if (lead.atencion_pendiente === "pide_asesor") {
    const desde = t(lead.atencion_desde);
    return !isNaN(desde) && now - desde >= PIDE_ASESOR() ? { motivo: "pide_asesor" } : null;
  }
  if (NOTA_DE_VOZ_RE.test(String(ultimoUsuario.content || "").trim())) {
    return now - desdeUsuario >= NOTA_DE_VOZ() ? { motivo: "nota_de_voz" } : null;
  }
  // Si la persona hablo de ultimo, Sofi le debe la respuesta: eso lo vigila
  // scheduler/lead-esperando.js.
  if (ultimoMensaje.role !== "assistant") return null;
  const desdeSofi = t(ultimoMensaje.created_at);
  const seguimiento = t(seg.t24_sent_at);
  if (seguimiento >= desdeUsuario) {
    return now - seguimiento >= TRAS_SEGUIMIENTO() ? { motivo: "no_contesto" } : null;
  }
  if (now - desdeUsuario < VENTANA) return null; // todavia le toca a Sofi
  return !isNaN(desdeSofi) && now - desdeSofi >= SIN_SEGUIMIENTO() ? { motivo: "sin_seguimiento" } : null;
}

const POR_QUE = {
  pide_asesor: "pidió hablar con un asesor y nadie le ha escrito",
  nota_de_voz: "mandó una nota de voz y Sofi no puede escucharla",
  no_contesto: "no le contestó a Sofi, ni siquiera al seguimiento",
  sin_seguimiento: "no le contestó a Sofi y ella ya no alcanza a escribirle (ventana de 24 h)",
};

const recorte = (s, n) => {
  const x = String(s || "").replace(/\s+/g, " ").trim();
  return x.length > n ? `${x.slice(0, n - 1)}…` : x;
};

// El WhatsApp a la asesora: quien es, como contactarlo y que quedo pendiente.
// Un colega no es un cliente final: va con su numero, como en el resumen de
// pedidos de 12 m./5 p. m. Un usuario sin telefono (BSUID "CO.xxx") solo se
// alcanza desde el CRM.
function textoParaAsesora({ lead, motivo, ultimoUsuario, ultimoSofi, crmUrl = null, soloLlamada = false }) {
  const quien = recorte(lead.nombre, 60) || (lead.source === "colega" ? "un colega" : "un cliente");
  const tipo = lead.source === "colega" ? "colega" : "cliente";
  const tel = String(lead.phone || "");
  const contacto = /^\d{8,15}$/.test(tel)
    ? `📞 wa.me/${tel}${soloLlamada ? " (prefiere LLAMADA)" : ""}`
    : "📞 No tenemos su número: escríbele desde el chat del CRM";
  const lineas = [
    `📞 *Hay que contactar a ${quien}* (${tipo})`,
    `Por qué: ${POR_QUE[motivo] || POR_QUE.no_contesto}.`,
    contacto,
  ];
  if (ultimoUsuario && !NOTA_DE_VOZ_RE.test(String(ultimoUsuario.content || ""))) lineas.push(`Lo último que escribió: "${recorte(ultimoUsuario.content, 160)}"`);
  if (ultimoSofi) lineas.push(`Lo último de Sofi: "${recorte(ultimoSofi.content, 220)}"`);
  if (crmUrl) lineas.push(`Chat: ${crmUrl}`);
  lineas.push("Escríbele o llámalo hoy. Si le escribes desde el CRM, Sofi se entera.");
  return lineas.join("\n");
}

module.exports = { motivoEscalar, textoParaAsesora, POR_QUE };
