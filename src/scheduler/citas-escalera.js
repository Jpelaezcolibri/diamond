// La escalera de una cita por confirmar (Juan, 2026-10-07; spec
// 2026-10-07-sofi-vendedora-y-agenda §4.3). Cada hora sin confirmar, la cita
// pasa al siguiente asesor del ciclo (1 -> 2 -> 3 -> 1...) con su aviso por
// plantilla, y al anterior se le dice que ya la tiene otro. Sigue asi hasta
// que alguien la confirme. De 20:00 a 08:00 (Bogota) se pausa. Si llega el
// corte (la visita menos 12 h, en horario habil: agenda-reglas.corteDe) sin confirmar, se cancela y Sofi le ofrece
// otro horario al cliente/colega. Reemplaza, para estas citas, al recordatorio
// unico de citas-recordatorio.js (que ignora las que tienen asesor_id).
const leads = require("../data/leads");
const organizations = require("../data/organizations");
const appointments = require("../data/appointments");
const rotacion = require("../data/rotacion-citas");
const reglas = require("../lib/agenda-reglas");
const { aliasPublico } = require("../lib/identidad-publica");
const { formatCitaFechaHora } = require("../notifications/advisor");

const PASO_MIN = Number(process.env.ESCALERA_PASO_MIN || 60);
// Aviso repetido a la misma asesora si a los 15 min no confirmo (brief
// citas-avisos §3, Juan 2026-10-21). Uno por asignacion: al rotar se reinicia.
const REAVISO_MIN = Number(process.env.ESCALERA_REAVISO_MIN || 15);
const INTERVALO_MIN = Number(process.env.ESCALERA_INTERVALO_MIN || 5);

function comoSiCreada(c) {
  const creada = new Date(c.creada_at || c.asignada_at).getTime();
  const tope = new Date(c.fecha_hora).getTime() - reglas.ANTICIPACION_MIN * 60 * 1000;
  return new Date(isNaN(tope) ? creada : Math.min(creada, tope));
}

// Que le toca a esta cita ahora: "nada", "rotar" (con el nuevo asesor) o
// "cortar". Pura: la decision se prueba sin base ni WhatsApp.
function pasoDeEscalera({ lead, ciclo, citasOrg, ahora = new Date() }) {
  const c = lead && lead.cita;
  if (!c) return { accion: "nada" };
  if (c.corte_at && ahora.getTime() >= new Date(c.corte_at).getTime()) return { accion: "cortar" };
  if (reglas.enPausa(ahora)) return { accion: "nada" };
  const desde = new Date(c.asignada_at || c.creada_at || 0).getTime();
  if (isNaN(desde) || ahora.getTime() - desde < PASO_MIN * 60 * 1000) return { accion: "nada" };
  // La anticipacion de 24 h se midio al crearla: para elegir al siguiente solo
  // cuentan horario y choque, asi que se evalua "como si fuera" creada_at (o
  // 24 h antes de la visita, si fue antes: una de arriendo vieja se creo con
  // 6 h y con la regla de hoy nadie mas "podria").
  const nuevo = rotacion.siguiente({
    ciclo,
    actualId: c.asesor_id,
    citasOrg,
    fechaHoraIso: c.fecha_hora,
    ahora: comoSiCreada(c),
    excluirLeadId: lead.id,
  });
  if (!nuevo || nuevo.id === c.asesor_id) return { accion: "nada" };
  return { accion: "rotar", nuevo };
}

// ¿Le toca hoy el aviso repetido a la asesora actual? Pura. Una vez por
// asignacion (reaviso_at posterior a asignada_at), nunca de noche, nunca
// pasado el corte. No cambia el paso de 60 min.
function tocaReaviso({ lead, ahora = new Date() }) {
  const c = lead && lead.cita;
  if (!c || !c.asesor_id || c.estado !== "propuesta") return false;
  if (c.corte_at && ahora.getTime() >= new Date(c.corte_at).getTime()) return false;
  if (reglas.enPausa(ahora)) return false;
  const desde = new Date(c.asignada_at || c.creada_at || 0).getTime();
  if (isNaN(desde) || desde <= 0) return false;
  if (ahora.getTime() - desde < REAVISO_MIN * 60 * 1000) return false;
  const ya = c.reaviso_at ? new Date(c.reaviso_at).getTime() : NaN;
  return !(ya >= desde);
}

function canal(deps) {
  return {
    aviso: deps.aviso || ((args) => require("../notifications/aviso-cita").avisarCitaPorConfirmar(args)),
    texto: deps.texto || ((...a) => require("../channels/whatsapp").sendWhatsApp(...a)),
    plantilla: deps.plantilla || ((...a) => require("../channels/whatsapp").sendWhatsAppTemplate(...a)),
    org: deps.org || ((id) => organizations.findById(id)),
    notificar: deps.notificar || ((...a) => require("../notifications/notificar").notificar(...a)),
    reaviso: deps.reaviso || ((...a) => require("../notifications/avisar-asesor").avisarAsesor(...a)),
    vencidas: deps.vencidas || ((args) => require("../lib/citas-vencidas").marcarVencidas(args)),
  };
}

function cuandoDe(cita) {
  const fh = formatCitaFechaHora(cita.fecha_hora);
  return fh ? `del ${fh.fecha} a las ${fh.hora}` : "acordada";
}

async function rotar({ org, lead, ciclo, nuevo, ahora, c }) {
  const anterior = ciclo.find((a) => a.id === lead.cita.asesor_id) || null;
  const ahoraIso = ahora.toISOString();
  const historial = (lead.cita.historial || []).map((h, i, arr) => (i === arr.length - 1 && !h.hasta ? { ...h, hasta: ahoraIso } : h));
  historial.push({ asesor_id: nuevo.id, desde: ahoraIso });
  const cita = {
    ...lead.cita,
    asesor_id: nuevo.id,
    advisor_id: nuevo.auth_user_id || null,
    asignada_at: ahoraIso,
    // El aviso repetido de 15 min vuelve a empezar con la nueva asesora.
    reaviso_at: null,
    historial,
  };
  await leads.update(lead.id, { cita });
  lead.cita = cita;
  await c.aviso({ org, advisor: nuevo, lead, cita }).catch((e) => console.warn("[citas-escalera] aviso al nuevo:", e.message));
  if (anterior) {
    await c.notificar({
      orgId: org.id, advisor: anterior, tipo: "cita_reasignada", titulo: `La visita pasó a ${aliasPublico(nuevo, org)}`,
      cuerpo: `${lead.nombre || `+${lead.phone}`} ${cuandoDe(cita)}`, link: "/calendario", leadId: lead.id,
    }).catch(() => {});
  }
  // Sin WhatsApp al celular (plan 6): el anterior se entera en la app.
  console.log(`[citas-escalera] lead ${lead.id}: ${anterior ? anterior.name : "?"} -> ${nuevo.name}`);
}

async function cortar({ org, lead, ciclo, ahora, c }) {
  const actual = ciclo.find((a) => a.id === lead.cita.asesor_id) || null;
  const cita = { ...lead.cita, estado: "cancelada", cancelada_at: ahora.toISOString(), motivo: "sin_confirmar" };
  await leads.update(lead.id, { cita, ...(lead.atencion_pendiente === "visita" ? { atencion_pendiente: null, atencion_desde: null } : {}) });
  lead.cita = cita;
  const fh = formatCitaFechaHora(cita.fecha_hora);
  await c
    .plantilla(org, lead.phone, {
      name: "cita_no_confirmada",
      bodyParams: [lead.nombre || "", fh ? `${fh.fecha} a las ${fh.hora}` : "acordada", cita.ref || "sin ref"],
    })
    .catch((e) => console.warn("[citas-escalera] aviso de corte al cliente:", e.message));
  if (actual) {
    await c.notificar({
      orgId: org.id, advisor: actual, tipo: "cita_cancelada", titulo: "Visita cancelada por falta de confirmación",
      cuerpo: `${lead.nombre || `+${lead.phone}`} ${cuandoDe(cita)}`, link: "/calendario", leadId: lead.id,
    }).catch(() => {});
  }
  console.log(`[citas-escalera] lead ${lead.id}: cancelada por falta de confirmacion`);
}

function refCuando(cita) {
  const fh = formatCitaFechaHora(cita.fecha_hora);
  return `Ref ${cita.ref || "sin ref"}, ${fh ? `${fh.fecha}, ${fh.hora}` : "sin hora"}`;
}

async function reavisar({ org, lead, ciclo, ahora, c }) {
  const actual = ciclo.find((a) => a.id === lead.cita.asesor_id) || null;
  if (!actual) return false;
  // Se marca ANTES de avisar: un fallo de WhatsApp no repite la campana.
  const cita = { ...lead.cita, reaviso_at: ahora.toISOString() };
  await leads.update(lead.id, { cita });
  lead.cita = cita;
  const quien = `${lead.nombre || `+${lead.phone}`}${lead.source === "colega" ? " (colega)" : ""}`;
  const corte = cita.corte_at ? formatCitaFechaHora(cita.corte_at) : null;
  await c
    .reaviso({
      org, advisor: actual, motivo: "visita", lead,
      titulo: `Sigue pendiente: visita por confirmar (${refCuando(cita)})`,
      cuerpo: `${quien}${corte ? ` · confírmala con el propietario antes de ${corte.fecha}, ${corte.hora}` : ""}`,
    })
    .catch((e) => console.warn("[citas-escalera] aviso repetido:", e.message));
  console.log(`[citas-escalera] lead ${lead.id}: aviso repetido a ${actual.name}`);
  return true;
}

let corriendo = false;
async function runOnce({ ahora = new Date(), deps = {} } = {}) {
  if (corriendo) return { rotadas: 0, cortadas: 0, reavisadas: 0, vencidas: 0 };
  corriendo = true;
  const c = canal(deps);
  let rotadas = 0;
  let cortadas = 0;
  let reavisadas = 0;
  let vencidas = 0;
  try {
    // Primero las vencidas (con o sin rotacion): una cita cuya hora ya paso
    // sale sola de "Para atender", sin escribirle a nadie.
    const v = await c.vencidas({ ahora }).catch((e) => {
      console.error("[citas-escalera] vencidas:", e.message);
      return null;
    });
    vencidas = (v && v.vencidas) || 0;
    const pendientes = await leads.listCitasPropuestasEnRotacion().catch((e) => {
      console.error("[citas-escalera] no se pudieron leer las citas:", e.message);
      return [];
    });
    const porOrg = new Map();
    for (const lead of pendientes) {
      try {
        if (!porOrg.has(lead.org_id)) {
          const org = await c.org(lead.org_id).catch(() => null);
          const ciclo = org ? await rotacion.asesoresDelCiclo(org.id).catch(() => []) : [];
          const citasOrg = org ? await appointments.citasDeLaOrg(org.id).catch(() => []) : [];
          porOrg.set(lead.org_id, { org, ciclo, citasOrg });
        }
        const { org, ciclo, citasOrg } = porOrg.get(lead.org_id);
        if (!org || ciclo.length === 0) continue;
        const paso = pasoDeEscalera({ lead, ciclo, citasOrg, ahora });
        if (paso.accion === "rotar") {
          await rotar({ org, lead, ciclo, nuevo: paso.nuevo, ahora, c });
          rotadas++;
        } else if (paso.accion === "cortar") {
          await cortar({ org, lead, ciclo, ahora, c });
          cortadas++;
        } else if (tocaReaviso({ lead, ahora })) {
          if (await reavisar({ org, lead, ciclo, ahora, c })) reavisadas++;
        }
      } catch (e) {
        console.error("[citas-escalera] error con lead", lead.id, e.message);
      }
    }
    return { rotadas, cortadas, reavisadas, vencidas };
  } finally {
    corriendo = false;
  }
}

let timer = null;
function start() {
  if (process.env.CITAS_ESCALERA_ENABLED === "false") {
    console.log("[citas-escalera] deshabilitada (CITAS_ESCALERA_ENABLED=false)");
    return null;
  }
  const tick = () => runOnce().catch((e) => console.error("[citas-escalera] runOnce:", e.message));
  setTimeout(tick, 60 * 1000);
  timer = setInterval(tick, INTERVALO_MIN * 60 * 1000);
  console.log(`[citas-escalera] activa — cada ${INTERVALO_MIN} min, paso ${PASO_MIN} min`);
  return timer;
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { pasoDeEscalera, tocaReaviso, runOnce, start, stop, REAVISO_MIN };
