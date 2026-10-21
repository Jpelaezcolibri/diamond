// La pausa por transferencia tiene salida (revision 2026-10-21, decision de
// Juan delegada al controlador).
//
// Desde 2026-10-21 la transferencia deja la conversacion en modo humano sin
// que nadie toque "Tomar control" (src/lib/transferencia.js). Si la asesora no
// aparece, el cliente quedaba sin Sofi para siempre. Esta pausa se marca en
// leads.seguimiento.pausa_transferencia = { at, conversation_id, advisor_id,
// reaviso_at } (jsonb ya existente: sin migracion) y el vigilante
// src/scheduler/lead-esperando.js la revisa cada 5 min:
//
//   - 30 min HABILES sin que la asesora escriba desde la transferencia: se le
//     repite el aviso (campana + aviso_app) UNA vez.
//   - 2 h HABILES: la conversacion vuelve a modo bot, Sofi le escribe al
//     cliente (solo dentro de la ventana de 24 h; fuera de ella no se le
//     escribe) y Juan recibe UNA alerta tecnica, sin telefono ni nombre del
//     cliente.
//   - Los relojes cuentan solo 8:00-20:00 Bogota: transferido a las 7:50 p. m.,
//     el aviso de 30 min sale a las ~8:20 a. m.
//   - La marca se borra cuando la asesora escribe desde el CRM (/send, /media),
//     cuando toma el control, o cuando la conversacion ya no esta en modo
//     humano (la devolvieron a Sofi). Un mensaje "assistant" posterior a la
//     marca tambien cuenta como que la asesora escribio.
//
// El reloj arranca en la transferencia (marca.at): el ultimo mensaje del
// cliente es el que la disparo, y un cliente que insiste no debe correr el
// plazo hacia adelante.

const { aliasPublico } = require("./identidad-publica");

const MIN = 60 * 1000;
const H = 60 * MIN;
const DIA = 24 * H;
const CLAVE = "pausa_transferencia";
const REAVISO_MS = 30 * MIN;
const DEVOLVER_MS = 2 * H;
const VENTANA_24H_MS = 24 * H;
const BOGOTA_OFFSET_MS = -5 * H; // Colombia no tiene horario de verano
const HORA_INICIO = 8;
const HORA_FIN = 20;

/** Pura: milisegundos entre `desde` y `hasta` que caen entre 8:00 y 20:00 Bogota. */
function msHabiles(desde, hasta) {
  let a = new Date(desde).getTime();
  let b = new Date(hasta).getTime();
  if (isNaN(a) || isNaN(b) || !(b > a)) return 0;
  a += BOGOTA_OFFSET_MS;
  b += BOGOTA_OFFSET_MS;
  let total = 0;
  for (let dia = Math.floor(a / DIA) * DIA; dia < b; dia += DIA) {
    const s = Math.max(a, dia + HORA_INICIO * H);
    const e = Math.min(b, dia + HORA_FIN * H);
    if (e > s) total += e - s;
  }
  return total;
}

function marcaDe(lead) {
  const m = lead && lead.seguimiento && lead.seguimiento[CLAVE];
  return m && m.at ? m : null;
}

/** Pura: que toca hacer con una conversacion pausada por transferencia. */
function pasoPausa({ marca, modo, ultimoAsistente = null, ahora = new Date() }) {
  if (!marca || !marca.at) return "nada";
  if (modo !== "humano") return "limpiar";
  if (ultimoAsistente && new Date(ultimoAsistente.created_at).getTime() > new Date(marca.at).getTime()) return "limpiar";
  const espera = msHabiles(marca.at, ahora);
  if (espera >= DEVOLVER_MS) return "devolver";
  if (espera >= REAVISO_MS && !marca.reaviso_at) return "reaviso";
  return "nada";
}

function textoDevolucion(alias) {
  return `Sigo pendiente de ti mientras ${alias} se desocupa. ¿En qué te puedo ayudar mientras tanto?`;
}

function depsPorDefecto() {
  return {
    leerLead: (orgId, leadId) => require("../data/leads").findById(orgId, leadId),
    actualizarLead: (id, patch) => require("../data/leads").update(id, patch),
    asesor: (orgId, id) => require("../data/advisors").findById(orgId, id),
    avisarAsesor: (...a) => require("../notifications/avisar-asesor").avisarAsesor(...a),
    setModo: (...a) => require("../data/conversations").setModo(...a),
    guardarMensaje: (...a) => require("../data/conversations").appendMessage(...a),
    setDelivery: (...a) => require("../data/conversations").setDelivery(...a),
    enviar: (...a) => require("../channels/whatsapp").sendWhatsApp(...a),
    alertaTecnica: (...a) => require("./alerta-saldo").enviarAlertaTecnica(...a),
  };
}

function conDeps(deps) {
  return deps ? { ...depsPorDefecto(), ...deps } : depsPorDefecto();
}

// Lee el lead FRESCO (otros caminos tambien escriben en seguimiento) y aplica
// `fn` sobre la marca; `fn` devuelve la marca nueva o null para borrarla.
// Devuelve el seguimiento escrito, o null si no habia lead.
async function escribirMarca(orgId, leadId, fn, d) {
  const fresco = await d.leerLead(orgId, leadId);
  if (!fresco) return null;
  const seguimiento = { ...(fresco.seguimiento || {}) };
  const nueva = fn(seguimiento[CLAVE] || null);
  if (nueva) seguimiento[CLAVE] = nueva;
  else delete seguimiento[CLAVE];
  await d.actualizarLead(leadId, { seguimiento });
  return seguimiento;
}

/** La llama cerrarTransferencia despues de pasar la conversacion a modo humano. */
async function marcar({ orgId, leadId, convId, advisorId, ahora = new Date() }, deps = null) {
  if (!orgId || !leadId) return false;
  const d = conDeps(deps);
  const seg = await escribirMarca(orgId, leadId, () => ({ at: ahora.toISOString(), conversation_id: convId || null, advisor_id: advisorId || null }), d);
  return Boolean(seg);
}

/** La asesora escribio o tomo el control. Nunca lanza; no escribe si no hay marca. */
async function limpiar({ orgId, leadId }, deps = null) {
  if (!orgId || !leadId) return false;
  try {
    const d = conDeps(deps);
    const fresco = await d.leerLead(orgId, leadId);
    if (!marcaDe(fresco)) return false;
    await escribirMarca(orgId, leadId, () => null, d);
    return true;
  } catch (e) {
    console.warn("[pausa-transferencia] No se pudo borrar la marca de pausa:", e.message);
    return false;
  }
}

/**
 * Un candidato de lead-esperando: { id, modo, whatsapp_phone_id, lead,
 * ultimoCliente, ultimoAsistente }. Devuelve "nada" | "limpiada" | "reaviso" | "devuelta".
 */
async function atenderPausa({ org, c, ahora = new Date() }, deps = null) {
  const marca = marcaDe(c && c.lead);
  if (!marca) return "nada";
  const d = conDeps(deps);
  const paso = pasoPausa({ marca, modo: c.modo, ultimoAsistente: c.ultimoAsistente, ahora });
  if (paso === "nada") return "nada";
  const lead = c.lead;

  if (paso === "limpiar") {
    const seg = await escribirMarca(org.id, lead.id, () => null, d);
    if (seg) lead.seguimiento = seg;
    return "limpiada";
  }

  const asesora = await Promise.resolve(d.asesor(org.id, marca.advisor_id || lead.transferido_advisor_id)).catch(() => null);

  if (paso === "reaviso") {
    // Se marca ANTES de avisar: el aviso sale una sola vez aunque falle.
    const seg = await escribirMarca(org.id, lead.id, (m) => (m ? { ...m, reaviso_at: ahora.toISOString() } : null), d);
    if (!seg || !seg[CLAVE]) return "nada";
    lead.seguimiento = seg;
    if (!asesora) {
      console.warn(`[pausa-transferencia] lead ${lead.id}: sin asesora duena para repetir el aviso`);
      return "reaviso";
    }
    const r = await d
      .avisarAsesor({
        org, advisor: asesora, motivo: "transferido", lead,
        titulo: `${lead.nombre || "Un cliente transferido"} sigue esperando: 30 min sin que le escribas`,
        cuerpo: "Sofi está en pausa en este chat. Si nadie le escribe en 2 h hábiles desde la transferencia, Sofi vuelve a contestar.",
      })
      .catch((e) => ({ ok: false, error: e.message }));
    if (!r || !r.ok) console.warn(`[pausa-transferencia] lead ${lead.id}: el aviso repetido no le llegó en tiempo real:`, r && r.error);
    return "reaviso";
  }

  // paso === "devolver". Primero el modo: si falla, la marca queda y se reintenta.
  await d.setModo(c.id, "bot");
  const seg = await escribirMarca(org.id, lead.id, () => null, d).catch((e) => {
    console.warn(`[pausa-transferencia] lead ${lead.id}: no se pudo borrar la marca:`, e.message);
    return null;
  });
  if (seg) lead.seguimiento = seg;
  c.modo = "bot";

  const alias = aliasPublico(asesora, org);
  const texto = textoDevolucion(alias);
  const ultimoCliente = c.ultimoCliente;
  const enVentana = Boolean(ultimoCliente && ahora.getTime() - new Date(ultimoCliente.created_at).getTime() < VENTANA_24H_MS);
  let resultado = "fuera de la ventana de 24 h: no se le escribió al cliente";
  if (enVentana && lead.phone) {
    const r = await Promise.resolve(d.enviar(org, lead.phone, texto, { fromPhoneId: c.whatsapp_phone_id || null })).catch((e) => ({ ok: false, error: e.message }));
    const ok = Boolean(r && r.ok);
    const msg = await Promise.resolve(d.guardarMensaje(c.id, "assistant", texto, { wa_message_id: (r && r.wamid) || null })).catch((e) => {
      console.warn(`[pausa-transferencia] lead ${lead.id}: no se pudo guardar el mensaje:`, e.message);
      return null;
    });
    if (msg && msg.id) await Promise.resolve(d.setDelivery(msg.id, ok ? "sent" : "failed", ok ? null : r && r.error)).catch(() => {});
    resultado = ok ? "Sofi le escribió al cliente" : `el mensaje al cliente falló (${(r && r.error) || "sin detalle"})`;
  }
  await Promise.resolve(
    d.guardarMensaje(c.id, "system", `Sofi volvió a contestar: nadie le escribió al cliente en 2 h hábiles desde la transferencia (${resultado}).`)
  ).catch(() => {});
  // Sin telefono ni nombre del cliente.
  await Promise.resolve(
    d.alertaTecnica(
      `Transferencia sin respuesta: lead ${lead.id} lleva 2 h hábiles sin que ${(asesora && asesora.name) || "la asesora"} escriba.`,
      `Sofi volvió a contestar; ${resultado}. Revisar el chat en el CRM ${(org && org.name) || ""}.`
    )
  ).catch(() => {});
  return "devuelta";
}

module.exports = { CLAVE, REAVISO_MS, DEVOLVER_MS, msHabiles, marcaDe, pasoPausa, textoDevolucion, marcar, limpiar, atenderPausa };
