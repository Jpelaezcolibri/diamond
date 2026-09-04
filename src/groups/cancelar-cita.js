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
const appointments = require("../data/appointments");
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

// LA CASCADA, UNA SOLA VEZ (Juan, 2026-09-04). Cancelar y reprogramar avisan
// por el mismo camino y con las mismas trampas (la ventana de 24 h, el lid, la
// alerta al equipo): duplicarlo garantizaba que un arreglo entrara en una de
// las dos mitades y no en la otra. `queCambio` es lo unico que difiere, y solo
// para que la alerta al equipo diga que paso.
//
// Devuelve "oficial" | "linea_natalia" | "no_se_pudo". Nunca lanza: el aviso es
// best-effort y el registro ya cambio antes de llegar aca.
async function avisarAlColega(org, lead, texto, { sesion = null, queCambio = "Cita cancelada" } = {}) {
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
    const alerta = `⚠️ ${queCambio} y NO le pudimos avisar a ${quien}. Escribile vos: la ventana de 24 h esta cerrada y la linea del radar tampoco pudo.`;
    for (const to of ALERTA_TO()) {
      await mensajeAsesor.enviarYRegistrar(org, to, alerta).catch((e) =>
        console.warn("[citas] no se pudo alertar del aviso fallido:", e.message)
      );
    }
  }

  return aviso;
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

  // El aviso es best-effort y va DESPUES del registro: si toda la cascada se
  // cae, la cita ya quedo cancelada igual (regla 1 del encabezado).
  const aviso = await avisarAlColega(org, lead, textoParaColega(cita, motivo), { sesion, queCambio: "Cita cancelada" })
    .catch((e) => {
      console.warn("[citas] la cascada de aviso fallo entera:", e.message);
      return "no_se_pudo";
    });

  return { ok: true, resultado: "cancelada", aviso };
}

// REPROGRAMAR (Juan, 2026-09-04). `leads.cita` es UN objeto, no una lista: no
// existe "la vieja" y "la nueva". Se mueve la hora en el mismo objeto y se
// guarda de donde venia en `reprogramada_desde` — asi el calendario muestra la
// nueva sin perder el rastro.
//
// El mensaje sigue la misma regla del blanqueado que el de cancelacion: sin
// "Diamond" y sin link, porque el colega se lo reenvia a su propio cliente.
function textoReprogramada(cita, motivo) {
  const cuando = cita && cita.fecha_hora ? new Date(cita.fecha_hora).toLocaleString("es-CO", { timeZone: "America/Bogota" }) : null;
  return [
    `Hola, te escribo para avisarte que la visita quedó reprogramada${cuando ? ` para el ${cuando}` : ""}.`,
    motivo ? `Motivo: ${motivo}.` : null,
    "Si no te sirve ese horario, decime y lo movemos.",
  ].filter(Boolean).join("\n\n");
}

// EL ORDEN DE LAS GUARDAS ES LA REGLA (Juan, 2026-09-04): fecha invalida y
// hora ocupada se rechazan ANTES de tocar el registro y ANTES de escribirle
// nada al colega. Mover una cita encima de otra del mismo asesor seria crear
// justo el problema que el anti-choque existe para evitar, y avisar de una
// mudanza que no ocurrio es peor que no avisar.
async function reprogramar(org, leadId, { nuevaFechaHora, motivo = null, sesion = null } = {}) {
  if (!nuevaFechaHora || isNaN(new Date(nuevaFechaHora).getTime())) {
    return { ok: false, resultado: "fecha_invalida", aviso: null };
  }
  const lead = await buscarLead(org && org.id, leadId);
  if (!lead || !lead.cita) return { ok: false, resultado: "no_encontrada", aviso: null };

  // La hora nueva pasa por la MISMA validacion que una cita puesta a mano
  // (appointments.checkAvailability), con `excludeLeadId` porque una cita no
  // choca consigo misma. Sin `advisor_id` no hay agenda a la cual preguntarle:
  // la cita no esta atribuida a nadie y no puede chocar con nadie.
  const advisorId = lead.cita.advisor_id || null;
  if (advisorId) {
    const dispo = await appointments
      .checkAvailability(org && org.id, { auth_user_id: advisorId }, nuevaFechaHora, { excludeLeadId: leadId })
      .catch(() => ({ disponible: true })); // la agenda caida no puede bloquear al humano que mueve la cita
    if (!dispo.disponible) return { ok: false, resultado: "hora_ocupada", aviso: null, motivo: dispo.motivo || null };
  }

  const cita = {
    ...lead.cita,
    fecha_hora: nuevaFechaHora,
    estado: "reprogramada",
    reprogramada_desde: lead.cita.fecha_hora || null,
    reprogramada_at: new Date().toISOString(),
    reprogramada_motivo: motivo,
  };
  await leads.update(leadId, { cita });

  const aviso = await avisarAlColega(org, lead, textoReprogramada(cita, motivo), { sesion, queCambio: "Cita reprogramada" })
    .catch((e) => {
      console.warn("[citas] la cascada de aviso fallo entera:", e.message);
      return "no_se_pudo";
    });

  return { ok: true, resultado: "reprogramada", aviso };
}

module.exports = { cancelar, reprogramar, textoParaColega, textoReprogramada };
