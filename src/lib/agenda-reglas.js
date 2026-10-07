// Reglas de agenda (Juan, 2026-10-07; spec 2026-10-07-sofi-vendedora-y-agenda
// §4.1): ninguna visita a menos de 24 h (es el colchon para que un asesor la
// confirme), dentro del horario del asesor, y cada cita bloquea 60 min de
// visita + 90 de traslado en la agenda de ESE asesor. Puras: sin base, para
// poder probarlas y reusarlas desde agendar_cita y la escalera.
const { partesBogota, DEFAULT_HORARIO } = require("../data/appointments");

const ANTICIPACION_MIN = Number(process.env.CITAS_ANTICIPACION_MIN_H || 24) * 60;
const DURACION_MIN = Number(process.env.CITAS_DURACION_MIN || 60);
const TRASLADO_MIN = Number(process.env.CITAS_TRASLADO_MIN || 90);
const BLOQUE_MIN = DURACION_MIN + TRASLADO_MIN;
const MIN = 60 * 1000;

const aMin = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
};

function dentroDeHorario(horario, iso) {
  const h = horario || DEFAULT_HORARIO;
  const p = partesBogota(iso);
  if (!p) return false;
  const dias = Array.isArray(h.dias) ? h.dias : DEFAULT_HORARIO.dias;
  if (!dias.includes(p.dia)) return false;
  return p.minutos >= aMin(h.desde || DEFAULT_HORARIO.desde) && p.minutos + DURACION_MIN <= aMin(h.hasta || DEFAULT_HORARIO.hasta);
}

function validarHora({ fechaHoraIso, ahora = new Date(), horario = null, ocupadas = [] }) {
  const t = new Date(fechaHoraIso).getTime();
  if (isNaN(t)) return { ok: false, motivo: "fecha_invalida" };
  if (t - ahora.getTime() < ANTICIPACION_MIN * MIN) return { ok: false, motivo: "anticipacion" };
  if (!dentroDeHorario(horario, fechaHoraIso)) return { ok: false, motivo: "fuera_de_horario" };
  const choca = (ocupadas || []).some((o) => {
    const u = new Date(o).getTime();
    return !isNaN(u) && Math.abs(u - t) < BLOQUE_MIN * MIN;
  });
  return choca ? { ok: false, motivo: "choque" } : { ok: true };
}

function alternativas({ ahora = new Date(), horario = null, ocupadas = [], n = 3, pasoMin = 30, horizonteDias = 14 }) {
  const paso = pasoMin * MIN;
  let ms = Math.ceil((ahora.getTime() + ANTICIPACION_MIN * MIN) / paso) * paso;
  const limite = ahora.getTime() + horizonteDias * 24 * 60 * MIN;
  const out = [];
  while (ms <= limite && out.length < n) {
    const iso = new Date(ms).toISOString();
    if (validarHora({ fechaHoraIso: iso, ahora, horario, ocupadas }).ok) out.push(iso);
    ms += paso;
  }
  return out;
}

function enSilencio(fecha = new Date()) {
  const p = partesBogota(fecha.toISOString());
  return !p || p.minutos >= 20 * 60 || p.minutos < 8 * 60;
}

function corteDe(fechaHoraIso) {
  return new Date(new Date(fechaHoraIso).getTime() - 4 * 60 * MIN).toISOString();
}

module.exports = { ANTICIPACION_MIN, DURACION_MIN, TRASLADO_MIN, BLOQUE_MIN, validarHora, alternativas, enSilencio, corteDe, dentroDeHorario };
