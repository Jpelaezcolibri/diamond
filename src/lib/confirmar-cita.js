// Confirmar u "otro horario" para una cita propuesta (spec 2026-10-07 §4.4-4.5).
// Lo usan el boton de la plantilla cita_por_confirmar (procesarBotonCita) y la
// tool confirmar_cita ("OK CONFIRMADA" escrito). La cita queda de quien
// confirma, aunque ya haya rotado: cualquiera del ciclo puede confirmar.
// Hacia el cliente/colega va el alias (identidad-publica.js), nunca el nombre
// real ni el celular; hacia adentro (confirmada_por, avisos) el nombre real.
const leads = require("../data/leads");
const advisors = require("../data/advisors");
const colegas = require("../data/colegas");
const citasData = require("../data/citas");
const { formatCitaFechaHora } = require("../notifications/advisor");
const { textoCitaConfirmada, aliasPublico } = require("./identidad-publica");

// Requires tardios del canal: whatsapp.js -> engine.js -> tools.js -> este archivo.
function canal(deps) {
  return {
    texto: deps.texto || ((...a) => require("../channels/whatsapp").sendWhatsApp(...a)),
    plantilla: deps.plantilla || ((...a) => require("../channels/whatsapp").sendWhatsAppTemplate(...a)),
    soloLlamada: deps.soloLlamada || ((orgId, tel) => colegas.esSoloLlamada(orgId, { telefono: tel })),
    notificar: deps.notificar || ((...a) => require("../notifications/notificar").notificar(...a)),
  };
}

function cuandoDe(cita) {
  const fh = formatCitaFechaHora(cita.fecha_hora);
  return fh ? `del ${fh.fecha} a las ${fh.hora}` : cita.descripcion || "acordada";
}

async function confirmar({ org, lead, advisor, deps = {} }) {
  const c = canal(deps);
  const cita = {
    ...lead.cita,
    estado: "confirmada",
    confirmada_at: new Date().toISOString(),
    confirmada_por: advisor.name,
    asesor_id: advisor.id,
    advisor_id: advisor.auth_user_id || lead.cita.advisor_id || null,
  };
  // La visita deja de estar pendiente en el chat del CRM (plan 6).
  await leads.update(lead.id, { cita, ...(lead.atencion_pendiente === "visita" ? { atencion_pendiente: null, atencion_desde: null } : {}) });
  lead.cita = cita;

  const quien = lead.nombre || `+${lead.phone}`;
  const cuando = cuandoDe(cita);
  const refLinea = cita.ref ? ` a la ref ${cita.ref}` : "";
  // Un colega "solo llamada" no recibe nada por escrito (2026-09-10); si la
  // consulta falla (null) tampoco se le escribe: se le pide al asesor llamar.
  const solo = lead.source === "colega" ? await c.soloLlamada(org.id, lead.phone).catch(() => null) : false;
  let avisado = false;
  if (solo === false) {
    const r = await c
      .texto(org, lead.phone, textoCitaConfirmada({ cuando, ref: cita.ref, advisor, org }))
      .catch((e) => ({ ok: false, error: e.message }));
    avisado = Boolean(r && r.ok);
  }

  // Los que la tuvieron antes en la rotacion se enteran de que ya no es suya.
  const otros = [...new Set((cita.historial || []).map((h) => h.asesor_id))].filter((id) => id && id !== advisor.id);
  for (const id of otros) {
    const a = await advisors.findById(org.id, id).catch(() => null);
    if (a) {
      await c.notificar({
        orgId: org.id, advisor: a, tipo: "cita_confirmada", titulo: `La confirmó ${aliasPublico(advisor, org)}`,
        cuerpo: `${quien} ${cuando}${refLinea}`, link: "/calendario", leadId: lead.id,
      }).catch(() => {});
    }
  }

  if (solo !== false) {
    return { ok: true, texto: `Confirmada en el sistema la cita con ${quien}${refLinea} para ${cuando} — pidió que lo contacten solo por llamada, así que no le escribí: avisale vos por llamada.` };
  }
  return {
    ok: true,
    texto: avisado
      ? `Confirmada la cita con ${quien}${refLinea} para ${cuando}. Ya le avisé por WhatsApp.`
      : `Confirmada en el sistema la cita con ${quien}${refLinea} para ${cuando}, pero no le pude avisar por acá (probablemente la ventana de 24h está cerrada) — avisale vos.`,
  };
}

// "Otro horario" del asesor: la cita se cancela y Sofi le ofrece otro horario
// al cliente/colega con la plantilla cita_no_confirmada (llega aunque la
// ventana este cerrada). Lo que responda le llega a Sofi y se reagenda.
async function pedirOtroHorario({ org, lead, advisor, deps = {} }) {
  const c = canal(deps);
  const cita = {
    ...lead.cita,
    estado: "cancelada",
    cancelada_at: new Date().toISOString(),
    cancelada_por: advisor.name,
    motivo: "asesor_pidio_otro_horario",
  };
  // La visita deja de estar pendiente en el chat del CRM (plan 6).
  await leads.update(lead.id, { cita, ...(lead.atencion_pendiente === "visita" ? { atencion_pendiente: null, atencion_desde: null } : {}) });
  lead.cita = cita;
  const fh = formatCitaFechaHora(cita.fecha_hora);
  const r = await c
    .plantilla(org, lead.phone, {
      name: "cita_no_confirmada",
      bodyParams: [lead.nombre || "", fh ? `${fh.fecha} a las ${fh.hora}` : "acordada", cita.ref || "sin ref"],
    })
    .catch((e) => ({ ok: false, error: e.message }));
  return {
    ok: true,
    texto: r && r.ok
      ? "Listo: la cancelé y le ofrecí otro horario. Cuando conteste, le llega a Sofi."
      : "Quedó cancelada, pero no le pude escribir: avisale vos que hay que buscar otro horario.",
  };
}

// Quien toca el boton. Tiene que ser un asesor ACTIVO (Natalia, inactiva,
// comparte el 8024 con la linea 2 de Daiana). El respaldo de entrega (ej.
// "Daiana Zea (línea 2)", sin recibe_citas) actua como el asesor del ciclo
// que tiene su mismo alias publico.
async function asesorDelBoton(org, userPhone) {
  const fila = await advisors.findByPhone(org.id, userPhone).catch(() => null);
  if (!fila || fila.activo === false) return null;
  if (fila.recibe_citas || !fila.alias_publico) return fila;
  const ciclo = await require("../data/rotacion-citas").asesoresDelCiclo(org.id).catch(() => []);
  return ciclo.find((a) => a.alias_publico === fila.alias_publico) || fila;
}

async function procesarBotonCita(org, userPhone, botonId, { deps = {} } = {}) {
  const [, leadId, accion] = String(botonId).split(":");
  const c = canal(deps);
  const advisor = await asesorDelBoton(org, userPhone);
  if (!advisor) {
    console.warn(`[confirmar-cita] Boton de cita desde un numero que no es asesor activo: ${userPhone}`);
    return;
  }
  const lead = await leads.findById(org.id, leadId).catch(() => null);
  if (!lead || !lead.cita) return;
  const estado = citasData.estadoDe(lead.cita);
  if (estado !== "propuesta") {
    await c.texto(org, userPhone, `Esa visita ya estaba ${estado}. No hace falta hacer nada.`).catch(() => {});
    return;
  }
  const r = accion === "otro"
    ? await pedirOtroHorario({ org, lead, advisor, deps })
    : await confirmar({ org, lead, advisor, deps });
  await c.texto(org, userPhone, r.texto).catch(() => {});
}

module.exports = { confirmar, pedirOtroHorario, procesarBotonCita };
