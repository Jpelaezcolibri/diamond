// Que le toca a una pregunta al asesor ahora (spec 2026-10-25 §5.3). Pura:
// se prueba sin base ni WhatsApp. Mismo ritmo que la escalera de citas:
// reaviso a los 15 min, rota cada hora, sin limite; pausa de noche y domingo.
const { enPausa } = require("./agenda-reglas");

const PASO_MIN = Number(process.env.PREGUNTA_PASO_MIN || 60);
const REAVISO_MIN = Number(process.env.PREGUNTA_REAVISO_MIN || 15);
const MIN = 60 * 1000;

function siguienteDe(ciclo, actualId) {
  const i = ciclo.findIndex((a) => a.id === actualId);
  return i === -1 ? ciclo[0] : ciclo[(i + 1) % ciclo.length];
}

function pasoDePregunta({ pregunta, ciclo, ahora = new Date() }) {
  if (!pregunta || pregunta.estado !== "pendiente" || !ciclo || ciclo.length === 0) return { accion: "nada" };
  if (enPausa(ahora)) return { accion: "nada" };
  if (!pregunta.asesor_id) return { accion: "asignar", nuevo: ciclo[0] };
  const desde = new Date(pregunta.asignada_at).getTime();
  if (isNaN(desde)) return { accion: "asignar", nuevo: ciclo[0] };
  const pasaron = ahora.getTime() - desde;
  if (pasaron >= PASO_MIN * MIN) return { accion: "rotar", nuevo: siguienteDe(ciclo, pregunta.asesor_id) };
  const ya = pregunta.reaviso_at ? new Date(pregunta.reaviso_at).getTime() : NaN;
  if (pasaron >= REAVISO_MIN * MIN && !(ya >= desde)) return { accion: "reaviso" };
  return { accion: "nada" };
}

module.exports = { pasoDePregunta, PASO_MIN, REAVISO_MIN };
