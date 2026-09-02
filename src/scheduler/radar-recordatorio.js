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
// Pasa por mensajeAsesor y no por canalWhatsapp directo: el recordatorio
// tambien queda guardado como mensaje real en la conversacion con el asesor
// (ver src/lib/mensaje-asesor.js), visible en el panel "Equipo" del CRM.
const mensajeAsesor = require("../lib/mensaje-asesor");
const ritmo = require("../lib/ritmo-avisos");

function resumenPedido(señal) {
  const texto = (señal.texto_original || "").replace(/\s+/g, " ").trim();
  if (!texto) return null;
  return texto.length > 100 ? `${texto.slice(0, 100)}...` : texto;
}

// UN mensaje por corrida, aunque haya varios pedidos vencidos a la vez
// (Juan, 2026-08-19): antes se mandaba un WhatsApp por cada senal pendiente
// —si se acumulaban seis, le llegaban seis mensajes seguidos, que se lee como
// acoso mas que como un aviso—. Ahora se consolida en uno solo por asesora
// por corrida. Cada senal individual sigue recordandose UNA sola vez en toda
// su vida (recordatorio_enviado_at, ver claimRecordatorio abajo); lo que
// cambia es que varias pendientes juntas llegan en un solo mensaje, no en N.
function textoRecordatorio(señales) {
  const lista = señales.map((s) => resumenPedido(s)).filter(Boolean);

  const cuerpo =
    señales.length === 1
      ? `¿en que quedo el pedido${lista[0] ? ` de "${lista[0]}"` : ""} que te avise hace un rato?`
      : `tenes ${señales.length} pedidos del radar sin resultado:\n\n${lista.map((t) => `▸ "${t}"`).join("\n")}\n\n¿en que quedaron?`;

  return [
    `Cathe, ${cuerpo}`,
    `Contame asi sea corto por cada uno (le escribi / no servia / hubo visita / se cerro) — con eso el radar aprende.`,
    `Es muy importante que respondas para poder seguir contando con el radar.`,
  ].join("\n\n");
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

    // Claim atomico POR SEÑAL antes de agrupar: si dos ticks corrieran a la
    // vez, cada senal la reclama solo uno — el otro tick la descarta en vez
    // de meterla dos veces en dos mensajes distintos.
    const reclamadas = [];
    for (const señal of candidatos) {
      try {
        if (await groupSignals.claimRecordatorio(org.id, señal.id)) reclamadas.push(señal);
      } catch (e) {
        console.error("[radar-recordatorio] error reclamando señal", señal.id, e.message);
      }
    }
    if (reclamadas.length === 0) continue;

    // Un mensaje por asesora, no uno por senal — ver la nota en
    // textoRecordatorio sobre por que se agrupa.
    const porAsesora = new Map();
    for (const señal of reclamadas) {
      const lista = porAsesora.get(señal.aviso_advisor_id) || [];
      lista.push(señal);
      porAsesora.set(señal.aviso_advisor_id, lista);
    }

    for (const [advisorId, señales] of porAsesora) {
      try {
        const advisor = await advisors.findById(org.id, advisorId);
        if (!advisor || !advisor.phone) continue;

        // MISMO FRENO QUE LOS AVISOS (Juan, 2026-09-02: "no quiero que seas
        // tan insistente"). Un recordatorio es un mensaje mas en el mismo
        // chat, asi que compite por la misma ventana: si a la asesora ya se
        // le escribio hace poco, este tick no insiste. El 1 de septiembre
        // Catherine recibio QUINCE recordatorios en un dia, ademas de 27
        // avisos, y no respondio ninguno.
        //
        // Las señales ya quedaron reclamadas (claimRecordatorio, arriba), asi
        // que no se recuerdan de nuevo: se pierde ESTE empujon, no el dato.
        // Es deliberado — el objetivo del recordatorio es que responda, y
        // amontonarle mensajes logra lo contrario.
        if (!ritmo.puedeEnviar(advisorId)) {
          console.log(`[radar-recordatorio] ${advisor.name} recibio algo hace poco: no se insiste con ${señales.length} pendiente(s).`);
          continue;
        }

        const { ok, error } = await mensajeAsesor.enviarYRegistrar(org, advisor.phone, textoRecordatorio(señales));
        if (ok) {
          ritmo.registrarEnvio(advisorId);
          sent++;
        } else {
          // No se reintenta: si fallo es casi siempre porque la ventana de
          // 24h ya cerro, y la unica forma de reabrirla es que ella escriba
          // primero — reintentar el mismo mensaje no cambiaria el resultado.
          console.warn(`[radar-recordatorio] No se pudo avisar a ${advisor.name}:`, error);
        }
      } catch (e) {
        console.error("[radar-recordatorio] error avisando a", advisorId, e.message);
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
