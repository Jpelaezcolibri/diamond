// Que le toca a una pregunta al asesor ahora (spec 2026-10-25 §5.3). Pura:
// se prueba sin base ni WhatsApp. Mismo ritmo que la escalera de citas:
// reaviso a los 15 min, rota cada hora; pausa de noche y domingo. Tope de
// avisos (caso 2026-10-29: 48 avisos por una sola pregunta en 3 dias): con
// PREGUNTA_MAX_AVISOS enviados deja de avisar y la pregunta queda en "Para
// atender" del CRM hasta que alguien la responda o la descarte.
const { enPausa } = require("./agenda-reglas");

const PASO_MIN = Number(process.env.PREGUNTA_PASO_MIN || 60);
const REAVISO_MIN = Number(process.env.PREGUNTA_REAVISO_MIN || 15);
const MAX_AVISOS = Number(process.env.PREGUNTA_MAX_AVISOS || 6);
const MIN = 60 * 1000;

function avisosDe(pregunta) {
  return Array.isArray(pregunta.wamids_aviso) ? pregunta.wamids_aviso.length : 0;
}

function siguienteDe(ciclo, actualId) {
  const i = ciclo.findIndex((a) => a.id === actualId);
  return i === -1 ? ciclo[0] : ciclo[(i + 1) % ciclo.length];
}

// enviados: los avisos que cuentan para el tope (el scheduler descuenta los que
// WhatsApp rechazo); sin el dato, todos los de wamids_aviso.
// ciclo: las asesoras a las que se les puede escribir ahora. Si la asignada ya
// no esta (se le cerro la ventana), la pregunta pasa a la primera.
function pasoDePregunta({ pregunta, ciclo, ahora = new Date(), enviados = null }) {
  if (!pregunta || pregunta.estado !== "pendiente" || !ciclo || ciclo.length === 0) return { accion: "nada" };
  if (enPausa(ahora)) return { accion: "nada" };
  const cuenta = enviados === null ? avisosDe(pregunta) : enviados;
  if (cuenta >= MAX_AVISOS) return { accion: "nada" };
  // ultimo: este aviso completa el tope; el scheduler cierra la escalera.
  const ultimo = cuenta + 1 >= MAX_AVISOS;
  if (!pregunta.asesor_id || !ciclo.some((a) => a.id === pregunta.asesor_id)) return { accion: "asignar", nuevo: ciclo[0], ultimo };
  const desde = new Date(pregunta.asignada_at).getTime();
  if (isNaN(desde)) return { accion: "asignar", nuevo: ciclo[0], ultimo };
  const pasaron = ahora.getTime() - desde;
  if (pasaron >= PASO_MIN * MIN) return { accion: "rotar", nuevo: siguienteDe(ciclo, pregunta.asesor_id), ultimo };
  const ya = pregunta.reaviso_at ? new Date(pregunta.reaviso_at).getTime() : NaN;
  if (pasaron >= REAVISO_MIN * MIN && !(ya >= desde)) return { accion: "reaviso", ultimo };
  return { accion: "nada" };
}

module.exports = { pasoDePregunta, PASO_MIN, REAVISO_MIN, MAX_AVISOS };
