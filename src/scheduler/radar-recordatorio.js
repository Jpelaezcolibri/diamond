// Recordatorio si la asesora no respondio el aviso de un pedido del radar.
//
// POR QUE EXISTE (Juan, 2026-08-18): el aviso de alerta-asesor.js ya termina
// pidiendo el resultado ("Contame en que quedo"), pero pedirlo no es lo mismo
// que conseguirlo. Sin un empujon, la respuesta se queda sin llegar por dos
// razones a la vez:
//
//   1. Calibracion: signal_events se queda sin el dato mas caro de conseguir
//      —que paso de verdad con la oportunidad— y el radar no puede aprender.
//   2. Ventana de WhatsApp: los mensajes de Sofi NO la renuevan, solo los
//      entrantes de la asesora. Si nunca responde, los avisos SIGUIENTES
//      empiezan a salir "pendientes" en vez de entregados.
//
// Temporizador in-process, mismo patron que src/scheduler/reminders.js: cada
// tick busca avisos salidos hace mas de `silenceMin` sin resultado todavia,
// reclama cada uno de forma atomica (recordatorio_enviado_at) y manda un
// texto libre. Si la ventana ya cerro, el envio falla y no se reintenta: la
// unica forma de reabrirla es que ella escriba, asi que reintentar no
// cambiaria el resultado.
const config = require("../config");
const organizations = require("../data/organizations");
const advisors = require("../data/advisors");
const groupSignals = require("../data/group-signals");
const signalEvents = require("../data/signal-events");
// Se importa el MODULO y no la funcion suelta: destructurar congela la
// referencia y deja los tests sin forma de mockear el envio (mismo criterio
// que src/groups/vivo.js).
const canalWhatsapp = require("../channels/whatsapp");

function textoRecordatorio(señal) {
  const pedido = (señal.texto_original || "").replace(/\s+/g, " ").trim().slice(0, 100);
  return [
    `Che, ¿en que quedo el pedido${pedido ? ` de "${pedido}${señal.texto_original && señal.texto_original.length > 100 ? "..." : ""}"` : ""} que te avise hace un rato?`,
    `Contame asi sea corto (le escribi / no servia / hubo visita / se cerro) — con eso el radar aprende.`,
  ].join("\n");
}

// Candidatos de una org: salieron hace mas de silenceMin y todavia no tienen
// resultado en signal_events. El cruce contra signal_events va aca (no en
// group-signals.js) por la misma regla de dependencia que respeta
// radar-trazabilidad.js: Radar -> Learning Domain, nunca al reves.
async function candidatosDeOrg(org, cutoffIso) {
  const candidatos = await groupSignals.candidatosRecordatorio(org.id, { antesDeIso: cutoffIso });
  if (candidatos.length === 0) return [];
  const ids = candidatos.map((s) => s.id);
  const ultimos = await signalEvents.ultimoPorSenal(org.id, ids).catch(() => new Map());
  return candidatos.filter((s) => !ultimos.has(s.id));
}

async function runOnce() {
  if (!config.groups.recordatorio.enabled) return { sent: 0 };

  const cutoff = new Date(Date.now() - config.groups.recordatorio.silenceMin * 60 * 1000).toISOString();
  const orgs = await organizations.listActive();

  let sent = 0;
  for (const org of orgs) {
    let candidatos;
    try {
      candidatos = await candidatosDeOrg(org, cutoff);
    } catch (e) {
      console.error("[radar-recordatorio] error leyendo candidatos de", org.name, e.message);
      continue;
    }

    for (const señal of candidatos) {
      try {
        // Claim atomico ANTES de enviar: si dos ticks corrieran a la vez,
        // solo uno gana — el otro se salta esta señal en vez de mandar dos
        // recordatorios por el mismo pedido.
        const claimed = await groupSignals.claimRecordatorio(org.id, señal.id);
        if (!claimed) continue;

        const advisor = await advisors.findById(org.id, señal.aviso_advisor_id);
        if (!advisor || !advisor.phone) continue;

        const { ok, error } = await canalWhatsapp.sendWhatsApp(org, advisor.phone, textoRecordatorio(señal));
        if (ok) {
          sent++;
        } else {
          // No se reintenta: si fallo es casi siempre porque la ventana de
          // 24h ya cerro, y la unica forma de reabrirla es que ella escriba
          // primero — reintentar el mismo mensaje no cambiaria el resultado.
          console.warn(`[radar-recordatorio] No se pudo avisar a ${advisor.name}:`, error);
        }
      } catch (e) {
        console.error("[radar-recordatorio] error con señal", señal.id, e.message);
      }
    }
  }
  if (sent) console.log(`[radar-recordatorio] ${sent} recordatorio(s) enviado(s)`);
  return { sent };
}

function start() {
  if (!config.groups.recordatorio.enabled) {
    console.log("[radar-recordatorio] deshabilitado (RADAR_RECORDATORIO_ENABLED=false)");
    return;
  }
  const ms = config.groups.recordatorio.intervalMin * 60 * 1000;
  setTimeout(() => runOnce().catch((e) => console.error("[radar-recordatorio] runOnce:", e.message)), 40 * 1000);
  setInterval(() => runOnce().catch((e) => console.error("[radar-recordatorio] runOnce:", e.message)), ms);
  console.log(
    `[radar-recordatorio] activo — cada ${config.groups.recordatorio.intervalMin} min, silencio ${config.groups.recordatorio.silenceMin} min`
  );
}

module.exports = { start, runOnce, textoRecordatorio, candidatosDeOrg };
