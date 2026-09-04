// Cancela una cita y le avisa al colega.
//
// DOS REGLAS, en este orden (Juan, 2026-09-04):
//
//   1. CANCELAR SIEMPRE CAMBIA EL REGISTRO, aunque el aviso falle. Una agenda
//      que miente es el problema que esto viene a arreglar; dejar la cita en
//      pie porque no pudimos escribir seria conservar el problema.
//   2. El aviso va en cascada, y el orden importa:
//        a. Linea oficial de Sofi — donde el colega ya esta hablando. Sujeta
//           a la ventana de 24 h de Meta: si el no escribio en ese plazo,
//           Meta lo rechaza.
//        b. Linea de Natalia (WAHA) — no tiene ventana, y es un numero que el
//           colega conoce de los grupos, no uno anonimo. Gasta de los ~300
//           mensajes/mes que WhatsApp le impone a esa linea.
//        c. Ninguna funciono -> se alerta al equipo para que avise a mano.
const leads = require("../data/leads");
const citas = require("../data/citas");
const canalWhatsapp = require("../channels/whatsapp");
const waha = require("../lib/waha");
const mensajeAsesor = require("../lib/mensaje-asesor");
const contacto = require("../lib/contacto");

const ALERTA_TO = () => (process.env.RADAR_WATCHDOG_TO || "").split(",").map((t) => t.trim()).filter(Boolean);

// Sin "Diamond" y sin link de la landing: el colega puede reenviarle este
// mensaje a su propio cliente (regla del mensaje blanqueado, 2026-08-18).
function textoParaColega(cita, motivo) {
  const cuando = cita && cita.fecha_hora ? new Date(cita.fecha_hora).toLocaleString("es-CO", { timeZone: "America/Bogota" }) : null;
  return [
    `Hola, te escribo para avisarte que la visita${cuando ? ` del ${cuando}` : ""} queda cancelada.`,
    motivo ? `Motivo: ${motivo}.` : null,
    "Disculpá el inconveniente. Si querés, te busco otras opciones parecidas.",
  ].filter(Boolean).join("\n\n");
}

// `leads.findById(orgId, id)` existe desde 2026-09-04 — se agrego en
// src/data/leads.js justo para este camino. Se llama con las dos partes, como
// TODOS los findById de src/data (advisors.js, mandatos.js): el repo es
// multi-tenant y un id sin org_id podria traer la cita de otra organizacion.
//
// Un error real de la base si se traga: sin fila, no hay nada que cancelar.
async function buscarLead(orgId, leadId) {
  return leads.findById(orgId, leadId).catch(() => null);
}

async function cancelar(org, leadId, { motivo = null, sesion = null } = {}) {
  const lead = await buscarLead(org && org.id, leadId);
  if (!lead || !lead.cita) return { ok: false, resultado: "no_encontrada", aviso: null };
  if (citas.estadoDe(lead.cita) === "cancelada") {
    return { ok: true, resultado: "ya_cancelada", aviso: null };
  }

  // PRIMERO el registro. Si el proceso muere en la linea siguiente, la cita ya
  // quedo cancelada y el calendario dice la verdad.
  const cita = { ...lead.cita, estado: "cancelada", cancelada_at: new Date().toISOString(), cancelada_motivo: motivo };
  await leads.update(leadId, { cita });

  const texto = textoParaColega(cita, motivo);
  let aviso = "no_se_pudo";

  // El unico identificador que tenemos en este camino es `lead.phone` — y el
  // nombre engaña: se confirmo en produccion que 9 de cada 10 colegas de los
  // grupos NO exponen telefono, WhatsApp los presenta con un @lid, y eso es
  // lo que termina guardado ahi. El criterio es el mismo que usa
  // src/groups/vivo.js: si tiene forma de celular colombiano real
  // (esCelularColombiano, 3 + 9 digitos con o sin 57) es un telefono; si no,
  // es un lid. Se calcula una sola vez y se reusa en los tres lugares de
  // abajo que necesitan distinguirlo (Juan, 2026-09-04).
  const esTelefono = contacto.esCelularColombiano(lead.phone);

  // PROBLEMA 2 (review 2026-09-04): la linea oficial es Meta Cloud API — no
  // entiende un lid, un lid ahi esta GARANTIZADO a fallar. Llamarla igual no
  // es "intentar por si acaso", es gastar una llamada a la Graph API que ya
  // sabemos inutil y demorar la caida al fallback que si puede funcionar.
  // Si no tiene forma de celular colombiano, se saltea directo a WAHA.
  const oficial = esTelefono
    ? await canalWhatsapp.sendWhatsApp(org, lead.phone, texto).catch((e) => ({ ok: false, error: e.message }))
    : null;
  if (oficial && oficial.ok) aviso = "oficial";
  else if (sesion) {
    // POR CUAL VIA SALE EL FALLBACK (Juan, 2026-09-04). Sin pasarle { lid } a
    // WAHA el chatId se arma como `<lid>@c.us` y el mensaje no llega justo a
    // la mayoria: el fallback quedaba decorativo para el caso que existe para
    // cubrir. Y NO se mandan los dos — la guarda de waha.js exige que un lid
    // entre solo por la opcion explicita.
    const destino = esTelefono ? lead.phone : null;
    const opcionesDm = esTelefono ? {} : { lid: lead.phone };
    const porWaha = await waha.enviarDm(sesion, destino, texto, opcionesDm).catch((e) => ({ ok: false, error: e.message }));
    if (porWaha && porWaha.ok) aviso = "linea_natalia";
  }

  if (aviso === "no_se_pudo") {
    // PROBLEMA 1 (review 2026-09-04): src/lib/contacto.js lo dice explicito —
    // mostrar un LID como si fuera un telefono es peor que no mostrarlo, quien
    // lee la alerta va a intentar marcarlo. Sin nombre y sin forma de celular
    // colombiano real, hay que decir la verdad en vez de armar un `+<lid>`.
    const quien = lead.nombre || (esTelefono ? `+${lead.phone}` : "un colega del grupo (sin teléfono visible)");
    const alerta = `⚠️ Cita cancelada y NO le pudimos avisar a ${quien}. Escribile vos: la ventana de 24 h esta cerrada y la linea del radar tampoco pudo.`;
    for (const to of ALERTA_TO()) {
      await mensajeAsesor.enviarYRegistrar(org, to, alerta).catch((e) =>
        console.warn("[citas] no se pudo alertar del aviso fallido:", e.message)
      );
    }
  }

  return { ok: true, resultado: "cancelada", aviso };
}

module.exports = { cancelar, textoParaColega };
