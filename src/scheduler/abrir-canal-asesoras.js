// Abre la ventana de 24 h de las asesoras que no la tienen (Juan, 2026-11-15:
// "necesito que abramos la ventana de los otros dos números, crea una
// plantilla que le podamos enviar para que la ventana se abra").
//
// WhatsApp solo entrega texto libre a quien le escribió a Sofi en las últimas
// 24 h. La de Daiana la mantiene abierta ventana-asesora.js (su línea está
// vinculada a WAHA); Claudia y Catherine no tienen ese truco y sus avisos
// fallaban con 131047 (39 de 59 el 2026-10-29). Una plantilla sí sale con la
// ventana cerrada, pero por sí sola NO la abre: la abre un mensaje de ELLA.
// Por eso la plantilla `abrir_canal_asesora` trae un botón "Estoy disponible":
// al tocarlo entra su mensaje y la ventana queda abierta 24 h
// (lib/canal-asesora.js lo registra y le contesta).
//
// Cuándo: una vez al día, de lunes a sábado, desde CANAL_ASESORAS_HORA (7 por
// defecto, hora de Bogotá; 30 min de margen por si un tick se cae), antes del
// Excel de pendientes de las 8. Solo a las del ciclo de visitas con la
// ventana cerrada. Una sola vez por asesora y día (marca en memoria: un
// reinicio dentro de la media hora puede costar un envío de más, nunca uno de
// menos).
//
// Interruptor: CANAL_ASESORAS_PLANTILLA (el nombre de la plantilla aprobada
// en Meta). Sin ella no sale nada.
const INTERVALO_MIN = 10;
const PAYLOAD = "canal:abrir";

const HORA = () => {
  const h = Number(process.env.CANAL_ASESORAS_HORA);
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 7;
};
const plantilla = () => String(process.env.CANAL_ASESORAS_PLANTILLA || "").trim();

function minutosBogota(fecha) {
  const t = new Date(fecha.getTime() - 5 * 3600 * 1000);
  return { dia: t.getUTCDay(), min: t.getUTCHours() * 60 + t.getUTCMinutes(), fecha: t.toISOString().slice(0, 10) };
}

// ¿Toca el envío del día? Pura: lunes a sábado, de HORA:00 a HORA:29.
function enTurno(ahora) {
  const { dia, min } = minutosBogota(ahora);
  if (dia === 0) return false;
  const inicio = HORA() * 60;
  return min >= inicio && min < inicio + 30;
}

function depsPorDefecto() {
  return {
    orgs: () => require("../data/organizations").listActive(),
    ciclo: (orgId) => require("../data/rotacion-citas").asesoresDelCiclo(orgId),
    abierta: (org, advisor, ahora) => require("../lib/ventana-asesoras").ventanaAbierta(org, advisor, ahora),
    enviar: (...a) => require("../channels/whatsapp").sendWhatsAppTemplate(...a),
  };
}

let enviadasHoy = new Map(); // advisor.id -> fecha (Bogotá)
let corriendo = false;

async function runOnce({ ahora = new Date(), deps = null } = {}) {
  const nombre = plantilla();
  if (!nombre || !enTurno(ahora) || corriendo) return { enviadas: 0 };
  corriendo = true;
  const d = deps ? { ...depsPorDefecto(), ...deps } : depsPorDefecto();
  const hoy = minutosBogota(ahora).fecha;
  let enviadas = 0;
  try {
    const orgs = await d.orgs().catch(() => []);
    for (const org of orgs || []) {
      const ciclo = await d.ciclo(org.id).catch(() => []);
      for (const a of ciclo || []) {
        if (!a || !a.phone || enviadasHoy.get(a.id) === hoy) continue;
        if (await d.abierta(org, a, ahora).catch(() => false)) continue;
        // Se marca ANTES de enviar: un fallo no se reintenta cada 10 min.
        enviadasHoy.set(a.id, hoy);
        const { nombreDePila } = require("../lib/identidad-publica");
        const r = await d
          .enviar(org, a.phone, { name: nombre, bodyParams: [nombreDePila(a) || "equipo"], buttonPayloads: [PAYLOAD] })
          .catch((e) => ({ ok: false, error: e.message }));
        if (r && r.ok) enviadas++;
        console.log(`[abrir-canal] ${a.name}: ${r && r.ok ? "plantilla enviada" : `falló (${(r && r.error) || "sin detalle"})`}`);
      }
    }
    return { enviadas };
  } finally {
    corriendo = false;
  }
}

let timer = null;
function start() {
  const tick = () => runOnce().catch((e) => console.error("[abrir-canal] runOnce:", e.message));
  timer = setInterval(tick, INTERVALO_MIN * 60 * 1000);
  setTimeout(tick, 2 * 60 * 1000);
  console.log(`[abrir-canal] ${plantilla() ? `activo con ${plantilla()}` : "apagado (CANAL_ASESORAS_PLANTILLA)"} — lunes a sábado a las ${HORA()}:00`);
  return timer;
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}
function _reset() {
  enviadasHoy = new Map();
  corriendo = false;
}

module.exports = { runOnce, start, stop, enTurno, PAYLOAD, _reset };
