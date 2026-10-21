// Citas vencidas sin confirmar (Juan, 2026-10-21; brief citas-avisos §1):
// "que las citas vencidas salgan solas de Para atender". Una cita que nadie
// confirmo y cuya hora ya paso no es un pendiente: es historia. Se marca
// `estado = 'vencida'` con `vencida_at` y se limpia el "Para atender" del chat.
// NO se le escribe a nadie: al cliente ya no le sirve un cita_no_confirmada
// tarde, y a la asesora no hay nada que pedirle.
//
// Interruptor de seguridad: las citas con hora anterior al 2026-10-21 00:00
// (Bogota) son las 6 viejas de julio y septiembre, de antes de la rotacion.
// Esas solo se tocan con CITAS_VENCER_ANTIGUAS=true o con el script
// scripts/citas-vencidas.js --aplicar, las dos cosas con el OK de Juan.

// Los estados crudos que todavia esperan confirmacion. "solicitada" es el que
// escribia agendar_cita antes de 2026-09-11 (estadoDe lo lee como confirmada,
// por eso aca se mira el valor crudo); "por_confirmar" por si alguna llego asi.
const ESTADOS_PENDIENTES = ["solicitada", "propuesta", "por_confirmar"];
// 2026-10-21 00:00 en Bogota (UTC-5 fijo).
const CORTE_ANTIGUAS_ISO = "2026-10-21T05:00:00.000Z";

function antiguasPermitidas() {
  return process.env.CITAS_VENCER_ANTIGUAS === "true";
}

function esAntigua(cita) {
  const t = new Date(cita && cita.fecha_hora).getTime();
  return !isNaN(t) && t < new Date(CORTE_ANTIGUAS_ISO).getTime();
}

// ¿La hora de esta cita ya paso sin que nadie la confirmara? Sin mirar el
// interruptor: es lo que tambien usa el CRM para no mostrarla como pendiente.
function pasoSinConfirmar(cita, ahora = new Date()) {
  if (!cita || !ESTADOS_PENDIENTES.includes(cita.estado)) return false;
  const t = new Date(cita.fecha_hora).getTime();
  return !isNaN(t) && t <= ahora.getTime();
}

// ¿El scheduler la puede marcar ya? Las antiguas, solo con el interruptor.
function esVencida(cita, { ahora = new Date(), antiguas = antiguasPermitidas() } = {}) {
  if (!pasoSinConfirmar(cita, ahora)) return false;
  if (esAntigua(cita) && !antiguas) return false;
  return true;
}

// El cambio que se le escribe al lead. Puro: lo comparten el scheduler, el
// boton "Descartar" del CRM y el script. No borra nada de la cita.
function patchVencida(lead, { ahora = new Date(), por = null } = {}) {
  const cita = { ...lead.cita, estado: "vencida", vencida_at: ahora.toISOString(), estado_anterior: lead.cita.estado };
  if (por) cita.vencida_por = por;
  const patch = { cita };
  if (lead.atencion_pendiente === "visita") {
    patch.atencion_pendiente = null;
    patch.atencion_desde = null;
  }
  return patch;
}

// Recorre las citas pendientes y marca las vencidas. Nunca lanza.
async function marcarVencidas({ ahora = new Date(), deps = {} } = {}) {
  const leads = require("../data/leads");
  const listar = deps.listar || (() => leads.listConCitaPendiente(ESTADOS_PENDIENTES));
  const actualizar = deps.actualizar || ((id, patch) => leads.update(id, patch));
  const antiguas = deps.antiguas != null ? deps.antiguas : antiguasPermitidas();
  const lista = await Promise.resolve()
    .then(listar)
    .catch((e) => {
      console.error("[citas-vencidas] no se pudieron leer las citas:", e.message);
      return [];
    });
  let vencidas = 0;
  let bloqueadas = 0;
  for (const lead of lista || []) {
    if (!pasoSinConfirmar(lead.cita, ahora)) continue;
    if (!esVencida(lead.cita, { ahora, antiguas })) {
      bloqueadas++;
      continue;
    }
    try {
      const patch = patchVencida(lead, { ahora });
      await actualizar(lead.id, patch);
      Object.assign(lead, patch);
      vencidas++;
      console.log(`[citas-vencidas] lead ${lead.id}: cita del ${lead.cita.fecha_hora} vencida sin confirmar`);
    } catch (e) {
      console.error("[citas-vencidas] error con lead", lead.id, e.message);
    }
  }
  return { vencidas, bloqueadas };
}

module.exports = { ESTADOS_PENDIENTES, CORTE_ANTIGUAS_ISO, esAntigua, pasoSinConfirmar, esVencida, patchVencida, marcarVencidas };
