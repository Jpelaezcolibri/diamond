// Reglas de agenda (Juan, 2026-10-07; spec 2026-10-07-sofi-vendedora-y-agenda
// §4.1): ninguna visita a menos de 24 h (es el colchon para que un asesor la
// confirme), dentro del horario del asesor, y cada cita bloquea 60 min de
// visita + 90 de traslado en la agenda de ESE asesor. Puras: sin base, para
// poder probarlas y reusarlas desde agendar_cita y la escalera.
const { partesBogota, DEFAULT_HORARIO } = require("../data/appointments");

const ANTICIPACION_MIN = Number(process.env.CITAS_ANTICIPACION_MIN_H || 24) * 60;
// Arriendo con menos colchon (spec 2026-10-21-sofi-super-agente §2.2): quien
// arrienda decide rapido y 24 h lo enfriaban. El corte de 4 h y la escalera no
// cambian: una cita de arriendo a 6 h tiene 2 h de escalera.
const ANTICIPACION_ARRIENDO_MIN = Number(process.env.CITAS_ANTICIPACION_ARRIENDO_H || 6) * 60;
const DURACION_MIN = Number(process.env.CITAS_DURACION_MIN || 60);
const TRASLADO_MIN = Number(process.env.CITAS_TRASLADO_MIN || 90);
const BLOQUE_MIN = DURACION_MIN + TRASLADO_MIN;
const MIN = 60 * 1000;

const aMin = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
};

// "arriendo" | "venta" | null. Acepta lo que traen properties.operacion
// ("Arriendo"/"Venta") y leads.categoria ("alquiler"/"compra").
function normalizarOperacion(op) {
  const s = String(op || "").toLowerCase();
  if (/arriendo|arrend|alquil|renta/.test(s)) return "arriendo";
  if (/venta|vend|compra/.test(s)) return "venta";
  return null;
}

// Sin operacion se comporta como siempre (la de venta).
function anticipacionMin(operacion) {
  return normalizarOperacion(operacion) === "arriendo" ? ANTICIPACION_ARRIENDO_MIN : ANTICIPACION_MIN;
}

function dentroDeHorario(horario, iso) {
  const h = horario || DEFAULT_HORARIO;
  const p = partesBogota(iso);
  if (!p) return false;
  const dias = Array.isArray(h.dias) ? h.dias : DEFAULT_HORARIO.dias;
  if (!dias.includes(p.dia)) return false;
  return p.minutos >= aMin(h.desde || DEFAULT_HORARIO.desde) && p.minutos + DURACION_MIN <= aMin(h.hasta || DEFAULT_HORARIO.hasta);
}

function validarHora({ fechaHoraIso, ahora = new Date(), horario = null, ocupadas = [], operacion = null }) {
  const t = new Date(fechaHoraIso).getTime();
  if (isNaN(t)) return { ok: false, motivo: "fecha_invalida" };
  if (t - ahora.getTime() < anticipacionMin(operacion) * MIN) return { ok: false, motivo: "anticipacion" };
  if (!dentroDeHorario(horario, fechaHoraIso)) return { ok: false, motivo: "fuera_de_horario" };
  const choca = (ocupadas || []).some((o) => {
    const u = new Date(o).getTime();
    return !isNaN(u) && Math.abs(u - t) < BLOQUE_MIN * MIN;
  });
  return choca ? { ok: false, motivo: "choque" } : { ok: true };
}

function alternativas({ ahora = new Date(), horario = null, ocupadas = [], n = 3, pasoMin = 30, horizonteDias = 14, operacion = null }) {
  const paso = pasoMin * MIN;
  let ms = Math.ceil((ahora.getTime() + anticipacionMin(operacion) * MIN) / paso) * paso;
  const limite = ahora.getTime() + horizonteDias * 24 * 60 * MIN;
  const out = [];
  while (ms <= limite && out.length < n) {
    const iso = new Date(ms).toISOString();
    if (validarHora({ fechaHoraIso: iso, ahora, horario, ocupadas, operacion }).ok) out.push(iso);
    ms += paso;
  }
  return out;
}

// Elige hasta 3 horarios bien separados de una lista ordenada de libres, para
// que la persona tenga una opcion real: 1) el primero; 2) el primero en otra
// media jornada (manana < 12:00, tarde >= 12:00, hora de Bogota) que el 1, el
// mismo dia si se puede y si no el siguiente; 3) el primero en un dia distinto
// al de los dos anteriores.
function espaciar(slots) {
  const llave = (iso) => {
    const l = new Date(new Date(iso).getTime() - 5 * 60 * MIN).toISOString(); // Bogota = UTC-5 fijo
    return { dia: l.slice(0, 10), mitad: Number(l.slice(11, 13)) < 12 ? "m" : "t" };
  };
  const lista = (slots || []).filter((x) => !isNaN(new Date(x).getTime())).sort();
  if (lista.length === 0) return [];
  const out = [lista[0]];
  const k1 = llave(lista[0]);
  const s2 = lista.find((x) => { const k = llave(x); return k.dia !== k1.dia || k.mitad !== k1.mitad; });
  if (s2) out.push(s2);
  const dias = new Set(out.map((x) => llave(x).dia));
  const s3 = lista.find((x) => !dias.has(llave(x).dia));
  if (s3) out.push(s3);
  return out.sort();
}

function enSilencio(fecha = new Date()) {
  const p = partesBogota(fecha.toISOString());
  return !p || p.minutos >= 20 * 60 || p.minutos < 8 * 60;
}

function corteDe(fechaHoraIso) {
  return new Date(new Date(fechaHoraIso).getTime() - 4 * 60 * MIN).toISOString();
}

module.exports = { ANTICIPACION_MIN, ANTICIPACION_ARRIENDO_MIN, anticipacionMin, normalizarOperacion, DURACION_MIN, TRASLADO_MIN, BLOQUE_MIN, validarHora, alternativas, espaciar, enSilencio, corteDe, dentroDeHorario };
