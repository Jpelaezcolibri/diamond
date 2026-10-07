// La escalera de una cita por confirmar (Juan, 2026-10-07; spec
// 2026-10-07-sofi-vendedora-y-agenda §4.3). Cada hora sin confirmar, la cita
// pasa al siguiente asesor del ciclo (1 -> 2 -> 3 -> 1...) con su aviso por
// plantilla, y al anterior se le dice que ya la tiene otro. Sigue asi hasta
// que alguien la confirme. De 20:00 a 08:00 (Bogota) se pausa. Si llega el
// corte (4 h antes de la visita) sin confirmar, se cancela y Sofi le ofrece
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
const INTERVALO_MIN = Number(process.env.ESCALERA_INTERVALO_MIN || 5);

// Que le toca a esta cita ahora: "nada", "rotar" (con el nuevo asesor) o
// "cortar". Pura: la decision se prueba sin base ni WhatsApp.
function pasoDeEscalera({ lead, ciclo, citasOrg, ahora = new Date() }) {
  const c = lead && lead.cita;
  if (!c) return { accion: "nada" };
  if (c.corte_at && ahora.getTime() >= new Date(c.corte_at).getTime()) return { accion: "cortar" };
  if (reglas.enSilencio(ahora)) return { accion: "nada" };
  const desde = new Date(c.asignada_at || c.creada_at || 0).getTime();
  if (isNaN(desde) || ahora.getTime() - desde < PASO_MIN * 60 * 1000) return { accion: "nada" };
  // La anticipacion de 24 h se midio al crearla: para elegir al siguiente solo
  // cuentan horario y choque, asi que se evalua "como si fuera" creada_at.
  const nuevo = rotacion.siguiente({
    ciclo,
    actualId: c.asesor_id,
    citasOrg,
    fechaHoraIso: c.fecha_hora,
    ahora: new Date(c.creada_at || c.asignada_at),
    excluirLeadId: lead.id,
  });
  if (!nuevo || nuevo.id === c.asesor_id) return { accion: "nada" };
  return { accion: "rotar", nuevo };
}

function canal(deps) {
  return {
    aviso: deps.aviso || ((args) => require("../notifications/aviso-cita").avisarCitaPorConfirmar(args)),
    texto: deps.texto || ((...a) => require("../channels/whatsapp").sendWhatsApp(...a)),
    plantilla: deps.plantilla || ((...a) => require("../channels/whatsapp").sendWhatsAppTemplate(...a)),
    org: deps.org || ((id) => organizations.findById(id)),
    notificar: deps.notificar || ((...a) => require("../notifications/notificar").notificar(...a)),
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
  if (anterior && anterior.phone) {
    const quien = lead.nombre || `+${lead.phone}`;
    await c
      .texto(org, anterior.phone, `La visita de ${quien} ${cuandoDe(cita)} pasó a ${aliasPublico(nuevo, org)} porque no se confirmó en una hora. Si igual podés tomarla, tocá Confirmar en el aviso anterior.`)
      .catch(() => {});
  }
  console.log(`[citas-escalera] lead ${lead.id}: ${anterior ? anterior.name : "?"} -> ${nuevo.name}`);
}

async function cortar({ org, lead, ciclo, ahora, c }) {
  const actual = ciclo.find((a) => a.id === lead.cita.asesor_id) || null;
  const cita = { ...lead.cita, estado: "cancelada", cancelada_at: ahora.toISOString(), motivo: "sin_confirmar" };
  await leads.update(lead.id, { cita });
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
  if (actual && actual.phone) {
    const quien = lead.nombre || `+${lead.phone}`;
    await c.texto(org, actual.phone, `Se canceló la visita de ${quien} ${cuandoDe(cita)}: nadie la confirmó a tiempo. Ya le ofrecimos otro horario.`).catch(() => {});
  }
  console.log(`[citas-escalera] lead ${lead.id}: cancelada por falta de confirmacion`);
}

let corriendo = false;
async function runOnce({ ahora = new Date(), deps = {} } = {}) {
  if (corriendo) return { rotadas: 0, cortadas: 0 };
  corriendo = true;
  const c = canal(deps);
  let rotadas = 0;
  let cortadas = 0;
  try {
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
        }
      } catch (e) {
        console.error("[citas-escalera] error con lead", lead.id, e.message);
      }
    }
    return { rotadas, cortadas };
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

module.exports = { pasoDeEscalera, runOnce, start, stop };
