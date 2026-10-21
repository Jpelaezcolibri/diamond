// Alerta a Juan cuando el radar se queda callado (2026-10-20).
//
// Del 25-sep al 16-oct el radar no recibio ni un pedido y nadie se entero; el
// volumen normal es de 80 a 117 pedidos por dia habil. Este vigilante mira cada
// 30 min (L-S, 8 a. m.-8 p. m. Bogota) la senal mas reciente de grupos y, si lleva
// mas de 6 horas HABILES sin pedidos, avisa a ALERTA_TECNICA_TO (Juan, nunca una
// asesora; ASESORA_SOLO_VISITAS no lo apaga). Lo mismo para la linea de DM con
// 24 horas habiles. Una alerta por episodio y un aviso corto al recuperarse.
// Interruptor: RADAR_CALLADO_ACTIVO (encendido salvo "false").

const { enviarAlertaTecnica } = require("../lib/alerta-saldo");

const BOGOTA_UTC = 5; // Colombia no tiene horario de verano
const HORA_INI = 8;
const HORA_FIN = 20;
const UMBRAL_RADAR_H = 6;
const UMBRAL_LINEA_H = 24;
const HORA_MS = 3600e3;

function activo() {
  return String(process.env.RADAR_CALLADO_ACTIVO ?? "true").toLowerCase() !== "false";
}

function enHorarioHabil(fecha) {
  const b = new Date(fecha.getTime() - BOGOTA_UTC * HORA_MS);
  return b.getUTCDay() !== 0 && b.getUTCHours() >= HORA_INI && b.getUTCHours() < HORA_FIN;
}

// Horas dentro de L-S 8-20 (Bogota) entre dos instantes.
function horasHabiles(desde, hasta) {
  const a = desde.getTime();
  const z = hasta.getTime();
  if (z <= a) return 0;
  const off = BOGOTA_UTC * HORA_MS;
  const DIA = 24 * HORA_MS;
  let total = 0;
  // Medianoche Bogota del dia de `desde`, en ms UTC.
  let dia = Math.floor((a - off) / DIA) * DIA + off;
  for (; dia < z; dia += DIA) {
    const dow = new Date(dia - off).getUTCDay();
    if (dow === 0) continue;
    const ini = Math.max(a, dia + HORA_INI * HORA_MS);
    const fin = Math.min(z, dia + HORA_FIN * HORA_MS);
    if (fin > ini) total += fin - ini;
  }
  return total / HORA_MS;
}

const estado = new Map(); // `${org}:${canal}` -> { ultima: ms de la ultima fila al alertar }

function depsPorDefecto() {
  const ultima = async (tabla, org) => {
    const supabase = require("../data/supabase");
    if (!supabase) return null;
    const { data } = await supabase.from(tabla).select("created_at").eq("org_id", org.id).order("created_at", { ascending: false }).limit(1);
    return data && data[0] ? new Date(data[0].created_at) : null;
  };
  return {
    orgs: () => require("../data/organizations").listActive(),
    ultimaSenal: (org) => ultima("group_signals", org),
    ultimaLinea: (org) => ultima("linea_dm", org),
    enviar: (resumen, detalle) => enviarAlertaTecnica(resumen, detalle),
  };
}

function fmt(fecha) {
  return fecha.toLocaleString("es-CO", { timeZone: "America/Bogota", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

async function revisarCanal(d, org, canal, ultima, ahora, umbral, textos) {
  const clave = `${org.id}:${canal}`;
  const previo = estado.get(clave);
  if (!ultima) return null;
  if (previo) {
    if (ultima.getTime() > previo.ultima) {
      estado.delete(clave);
      await d.enviar(textos.volvio, "").catch(() => false);
      return "recuperado";
    }
    return null; // mismo episodio: ya se aviso
  }
  if (horasHabiles(ultima, ahora) <= umbral) return null;
  estado.set(clave, { ultima: ultima.getTime() });
  await d.enviar(textos.alerta(fmt(ultima)), "").catch(() => false);
  return "alertado";
}

async function runOnce({ ahora = new Date(), deps = null } = {}) {
  if (!activo() || !enHorarioHabil(ahora)) return [];
  const d = deps || depsPorDefecto();
  const out = [];
  for (const org of await d.orgs()) {
    try {
      const r1 = await revisarCanal(d, org, "radar", await d.ultimaSenal(org), ahora, UMBRAL_RADAR_H, {
        alerta: (f) => `El radar no recibe pedidos desde ${f}: revisar WAHA/sesión, saldo de Anthropic y el sync.`,
        volvio: "El radar volvió a recibir pedidos.",
      });
      if (r1) out.push({ org: org.id, canal: "radar", accion: r1 });
      const r2 = await revisarCanal(d, org, "linea", await d.ultimaLinea(org), ahora, UMBRAL_LINEA_H, {
        alerta: (f) => `La línea de DM no recibe mensajes desde ${f}: revisar la sesión de WAHA y el webhook.`,
        volvio: "La línea de DM volvió a recibir mensajes.",
      });
      if (r2) out.push({ org: org.id, canal: "linea", accion: r2 });
    } catch (e) {
      console.error("[radar-callado] error:", e.message);
    }
  }
  return out;
}

function start() {
  if (!activo()) return console.log("[radar-callado] apagado (RADAR_CALLADO_ACTIVO=false)");
  const tick = () => runOnce().catch((e) => console.error("[radar-callado] runOnce:", e.message));
  setTimeout(tick, 3 * 60 * 1000);
  setInterval(tick, 30 * 60 * 1000);
  console.log("[radar-callado] activo — avisa a Juan si el radar pasa 6 h hábiles sin pedidos");
}

function _reset() {
  estado.clear();
}

module.exports = { start, runOnce, horasHabiles, enHorarioHabil, _reset };
