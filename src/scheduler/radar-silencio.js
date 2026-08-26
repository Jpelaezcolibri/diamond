// Escalado por SILENCIO a Catherine si Natalia (asesor PRINCIPAL del radar de
// grupos, ver src/data/advisors.js#findAsesorPrincipalRadar) no responde el
// aviso a tiempo.
//
// POR QUE EXISTE (Juan, 2026-08-26): Natalia tiene que ser siempre la
// destinataria primaria de los dos carriles del radar (venta y compra) porque
// esta DENTRO de los grupos gremiales y puede copiar el aviso directo al
// grupo del que se esta hablando. Pero si el aviso no le llega, o le llega y
// no contesta en el tiempo configurado (RADAR_SILENCIO_MIN), el pedido no
// puede quedarse sin que nadie lo atienda -- se escala a Catherine.
//
// Cubre los DOS carriles con el mismo temporizador in-process (mismo patron
// que src/scheduler/radar-recordatorio.js): un claim atomico POR SEÑAL antes
// de escalar, para que dos ticks concurrentes no la escalen dos veces.
const config = require("../config");
const organizations = require("../data/organizations");
const groupSignals = require("../data/group-signals");
const signalEvents = require("../data/signal-events");
const mandatosData = require("../data/mandatos");
const avisarMandato = require("../groups/avisar-mandato");
const leads = require("../data/leads");
const conversations = require("../data/conversations");
const mensajeAsesor = require("../lib/mensaje-asesor");

const RADAR_REVISOR_PHONE = () => process.env.RADAR_REVISOR_PHONE || "";
const RADAR_ESCALADO_PHONE = () => process.env.RADAR_ESCALADO_PHONE || "";

// Mismo recorte de 100 caracteres que src/scheduler/radar-recordatorio.js#resumenPedido.
function resumenPedido(señal) {
  const texto = (señal.texto_original || "").replace(/\s+/g, " ").trim();
  if (!texto) return null;
  return texto.length > 100 ? `${texto.slice(0, 100)}...` : texto;
}

function textoEscaladoVenta(señal) {
  const resumen = resumenPedido(señal);
  return [
    `⚠️ Natalia no respondio en el tiempo configurado el aviso de este pedido${resumen ? ` ("${resumen}")` : ""}.`,
    "¿Le puedes dar seguimiento?",
  ].join("\n");
}

// Candidatos de venta de una org: salieron hace mas de `silencio.min` sin
// escalar todavia, y sin resultado ya registrado en signal_events. El cruce
// contra signal_events va aca (no en group-signals.js) por la misma regla de
// dependencia que respeta radar-recordatorio.js: Radar -> Learning Domain,
// nunca al reves.
async function candidatosVentaDeOrg(org, cutoffIso) {
  const candidatos = await groupSignals.candidatosEscaladoSilencio(org.id, { antesDeIso: cutoffIso });
  if (candidatos.length === 0) return [];
  const ids = candidatos.map((s) => s.id);
  const ultimos = await signalEvents.ultimoPorSenal(org.id, ids).catch(() => new Map());
  return candidatos.filter((s) => !ultimos.has(s.id));
}

// ¿Natalia respondio ESTE aviso? Un mensaje de ella posterior a `entregadoAt`
// cuenta como respuesta; uno anterior es una conversacion vieja que no tiene
// nada que ver con este match puntual.
async function nataliaRespondio(org, entregadoAt) {
  const telefono = RADAR_REVISOR_PHONE();
  if (!telefono) return false;
  const lead = await leads.findOrCreate(org.id, telefono, "asesor").catch(() => null);
  if (!lead) return false;
  const conv = await conversations.findOrCreate(org.id, lead.id, null).catch(() => null);
  if (!conv) return false;
  const ultimo = await conversations.lastMessage(conv.id).catch(() => null);
  if (!ultimo || ultimo.role !== "user") return false;
  return new Date(ultimo.created_at).getTime() > new Date(entregadoAt).getTime();
}

async function runVenta(org, cutoffIso) {
  let sent = 0;
  let candidatos;
  try {
    candidatos = await candidatosVentaDeOrg(org, cutoffIso);
  } catch (e) {
    console.error("[radar-silencio] error leyendo candidatos de venta de", org.name, e.message);
    return sent;
  }

  const to = RADAR_ESCALADO_PHONE();
  if (!to) return sent;

  for (const señal of candidatos) {
    try {
      if (!(await groupSignals.claimEscaladoSilencio(org.id, señal.id))) continue;
      const { ok, error } = await mensajeAsesor.enviarYRegistrar(org, to, textoEscaladoVenta(señal));
      if (ok) sent++;
      else console.warn(`[radar-silencio] no se pudo escalar la señal ${señal.id}:`, error);
    } catch (e) {
      console.error("[radar-silencio] error escalando señal", señal.id, e.message);
    }
  }
  return sent;
}

async function runCompra(org, cutoffIso) {
  let sent = 0;
  let pendientes;
  try {
    pendientes = await mandatosData.pendientesDeSilencio(org.id, { antesDeIso: cutoffIso });
  } catch (e) {
    console.error("[radar-silencio] error leyendo pendientes de compra de", org.name, e.message);
    return sent;
  }

  for (const fila of pendientes) {
    try {
      if (await nataliaRespondio(org, fila.entregado_at)) continue;

      const mandato = await mandatosData.findById(org.id, fila.mandato_id).catch(() => null);
      if (!mandato) continue;

      const ok = await avisarMandato.escalar(org, {
        texto: fila.texto,
        mandato,
        motivo: "sin respuesta en el tiempo configurado",
        alertaId: fila.id,
      });
      if (ok) sent++;
    } catch (e) {
      console.error("[radar-silencio] error escalando match de mandato", fila.id, e.message);
    }
  }
  return sent;
}

async function runOnce() {
  const cutoff = new Date(Date.now() - config.groups.silencio.min * 60 * 1000).toISOString();
  const orgs = await organizations.listActive();

  let sent = 0;
  for (const org of orgs) {
    sent += await runVenta(org, cutoff);
    sent += await runCompra(org, cutoff);
  }
  if (sent) console.log(`[radar-silencio] ${sent} escalado(s) por silencio enviado(s)`);
  return { sent };
}

function start() {
  const ms = config.groups.silencio.intervalMin * 60 * 1000;
  setTimeout(() => runOnce().catch((e) => console.error("[radar-silencio] runOnce:", e.message)), 40 * 1000);
  setInterval(() => runOnce().catch((e) => console.error("[radar-silencio] runOnce:", e.message)), ms);
  console.log(
    `[radar-silencio] activo — cada ${config.groups.silencio.intervalMin} min, silencio ${config.groups.silencio.min} min`
  );
}

module.exports = { start, runOnce, candidatosVentaDeOrg, nataliaRespondio, textoEscaladoVenta };
