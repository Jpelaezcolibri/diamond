// Reglas de agenda (Juan, 2026-10-07; spec 2026-10-07-sofi-vendedora-y-agenda
// §4.1): ninguna visita a menos de 24 h (es el colchon para que un asesor la
// confirme), dentro del horario del asesor, y cada cita bloquea 60 min de
// visita + 90 de traslado en la agenda de ESE asesor. Puras: sin base, para
// poder probarlas y reusarlas desde agendar_cita y la escalera.
const { partesBogota, DEFAULT_HORARIO } = require("../data/appointments");

// 24 h para TODA visita, venta o arriendo (Juan, 2026-10-21: "las citas solo
// las hagas minimo con 24 horas para la confirmacion con el dueño de la
// propiedad"). Reemplaza las 6 h de arriendo de la spec 2026-10-21 §2.2: la
// operacion ya no cambia la anticipacion.
const ANTICIPACION_MIN = Number(process.env.CITAS_ANTICIPACION_MIN_H || 24) * 60;
// Plazo para que el asesor confirme la visita: la visita menos 12 h, llevado a
// horario habil (ver corteDe).
const CORTE_HORAS_ANTES = Number(process.env.CITAS_CORTE_HORAS_ANTES || 12);
const CORTE_MIN_DESDE_PEDIDO_H = 2;
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

// Igual para venta y arriendo desde 2026-10-21.
function anticipacionMin() {
  return ANTICIPACION_MIN;
}

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

// Elige hasta 3 horarios bien separados de una lista de libres, para que la
// persona tenga una opcion real: 1) el primero; 2) el primero en la OTRA media
// jornada (manana < 12:00, tarde >= 12:00, hora de Bogota) en todo el
// horizonte, y solo si no hay ninguno en esa otra media jornada, el primero de
// otro dia; 3) el primero en un dia distinto al de los dos anteriores.
function espaciar(slots) {
  const llave = (iso) => {
    const p = partesBogota(iso);
    return { dia: new Date(new Date(iso).getTime() - 5 * 60 * MIN).toISOString().slice(0, 10), mitad: p.minutos < 12 * 60 ? "m" : "t" };
  };
  const lista = (slots || []).filter((x) => !isNaN(new Date(x).getTime())).sort();
  if (lista.length === 0) return [];
  const out = [lista[0]];
  const k1 = llave(lista[0]);
  const s2 = lista.find((x) => llave(x).mitad !== k1.mitad) || lista.find((x) => llave(x).dia !== k1.dia);
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

// PLAZO PARA CONFIRMAR CON EL PROPIETARIO (Juan, 2026-10-21: "calcula un buen
// tiempo para la confirmacion"). Antes: la visita menos 4 h. Ahora:
// 1) la visita menos CORTE_HORAS_ANTES (12 h);
// 2) si eso cae de noche en Bogota (despues de las 20:00 o antes de las 08:00),
//    se adelanta a las 20:00 de esa noche (visita jueves 10:00 -> miercoles
//    20:00; jueves 16:00 = 04:00 -> miercoles 20:00);
// 2b) si el corte cae en domingo, pasa al sabado 20:00;
// 3) nunca antes de 2 h despues del pedido; si ese minimo cae de noche, pasa a
//    las 08:00 siguientes (si ese minimo cae en domingo se respeta igual:
//    el minimo de 2 h gana sobre la regla del domingo);
// 4) y nunca a menos de 2 h de la visita.
// Las citas viejas conservan el corte_at que ya tienen guardado.
// Bogota no tiene horario de verano: UTC-5 fijo.
const BOGOTA_MS = 5 * 60 * MIN;
const DIA_MS = 24 * 60 * MIN;
// Medianoche (en ms UTC) del dia de Bogota que contiene `ms`.
const inicioDiaBogota = (ms) => Math.floor((ms - BOGOTA_MS) / DIA_MS) * DIA_MS + BOGOTA_MS;
const minutosBogota = (ms) => (ms - inicioDiaBogota(ms)) / MIN;
const esDomingoBogota = (ms) => new Date(inicioDiaBogota(ms) - BOGOTA_MS).getUTCDay() === 0;
// Pausa de la escalera: noche o domingo (no se rota ni se reavisa).
function enPausa(fecha = new Date()) {
  return enSilencio(fecha) || esDomingoBogota(fecha.getTime());
}
function corteDe(fechaHoraIso, { ahora = new Date() } = {}) {
  const visita = new Date(fechaHoraIso).getTime();
  if (isNaN(visita)) return null;
  let corte = visita - CORTE_HORAS_ANTES * 60 * MIN;
  const m = minutosBogota(corte);
  if (m > 20 * 60) corte = inicioDiaBogota(corte) + 20 * 60 * MIN;
  else if (m < 8 * 60) corte = inicioDiaBogota(corte) - DIA_MS + 20 * 60 * MIN;
  // El domingo no es dia habil para confirmar: pasa al sabado 20:00.
  if (esDomingoBogota(corte)) corte = inicioDiaBogota(corte) - DIA_MS + 20 * 60 * MIN;
  const minimo = ahora.getTime() + CORTE_MIN_DESDE_PEDIDO_H * 60 * MIN;
  if (corte < minimo) {
    corte = minimo;
    const mm = minutosBogota(corte);
    if (mm > 20 * 60) corte = inicioDiaBogota(corte) + DIA_MS + 8 * 60 * MIN;
    else if (mm < 8 * 60) corte = inicioDiaBogota(corte) + 8 * 60 * MIN;
  }
  corte = Math.min(corte, visita - 2 * 60 * MIN);
  return new Date(corte).toISOString();
}

// El corte en palabras, para que Sofi lo diga: "hoy a las 8:00 p. m.",
// "mañana a las 8:00 a. m." o "el miércoles 22 de octubre a las 8:00 p. m.".
function corteEnPalabras(corteIso, { ahora = new Date() } = {}) {
  const t = new Date(corteIso).getTime();
  if (isNaN(t)) return null;
  const { formatCitaFechaHora } = require("../notifications/advisor");
  const fh = formatCitaFechaHora(corteIso);
  if (!fh) return null;
  const dias = Math.round((inicioDiaBogota(t) - inicioDiaBogota(ahora.getTime())) / DIA_MS);
  if (dias === 0) return `hoy a las ${fh.hora}`;
  if (dias === 1) return `mañana a las ${fh.hora}`;
  return `el ${fh.fecha.replace(",", "")} a las ${fh.hora}`;
}

module.exports = { ANTICIPACION_MIN, CORTE_HORAS_ANTES, anticipacionMin, normalizarOperacion, DURACION_MIN, TRASLADO_MIN, BLOQUE_MIN, validarHora, alternativas, espaciar, enSilencio, enPausa, esDomingoBogota, corteDe, corteEnPalabras, dentroDeHorario };
