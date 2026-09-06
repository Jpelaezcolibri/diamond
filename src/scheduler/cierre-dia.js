// El cierre del dia: una sola corrida diaria que le pregunta a cada asesora en
// que quedaron LAS PROPIEDADES que se movieron hoy.
//
// POR QUE REEMPLAZA AL RECORDATORIO (Juan, 2026-09-06). radar-recordatorio.js
// mandaba, cada 20 minutos, un mensaje que citaba el texto del COLEGA:
// "¿en que quedo el pedido de 'Buenas tardes Quién tiene lotes para construir
// bodega en zona franca Rionegro...'?". Juan: "el asesor no sabe de que
// propiedad estan hablando". Y solo cobraba los avisos, no los DM que Sofi
// mandaba sola: en septiembre salieron 54 mensajes y quedo 1 resultado.
//
// El armado del texto no vive aca sino en src/groups/cierre-dia.js, que es
// puro. Este archivo solo consulta, reclama, envia y registra.

const config = require("../config");
const organizations = require("../data/organizations");
const advisors = require("../data/advisors");
const signalEvents = require("../data/signal-events");
const radarCierres = require("../data/radar-cierres");
const cierreDia = require("../groups/cierre-dia");
const mensajeAsesor = require("../lib/mensaje-asesor");
const ritmo = require("../lib/ritmo-avisos");
// Mismo patron que group-digest.js, que ya importa de followups: los helpers
// de hora de Bogota viven ahi y no se duplican.
const { hourInBogota } = require("./followups");
const { hoyEnBogota } = require("./group-digest");

// Bogota es UTC-5 todo el año (Colombia no cambia de hora), asi que el dia
// natural va de las 05:00Z a las 05:00Z del dia siguiente. Se calcula del
// string de fecha y no de `Date.now()` para que la ventana sea la MISMA que la
// que se guarda en radar_cierres.fecha.
function ventanaDelDia(fecha) {
  const desde = new Date(`${fecha}T05:00:00.000Z`);
  const hasta = new Date(desde.getTime() + 86400000);
  return { desdeIso: desde.toISOString(), hastaIso: hasta.toISOString() };
}

// A quien le corresponde cada señal. Si le llego un aviso, a quien lo recibio.
// Si salio por DM al colega, a la asesora principal del radar: nadie mas la vio
// pasar, y es la que puede contar en que quedo.
function agruparPorAsesora(señales, asesorPrincipalId) {
  const porAsesora = new Map();
  for (const señal of señales) {
    const advisorId = señal.aviso_advisor_id || asesorPrincipalId;
    if (!advisorId) continue;
    const lista = porAsesora.get(advisorId) || [];
    lista.push(señal);
    porAsesora.set(advisorId, lista);
  }
  return porAsesora;
}

async function runOnce({ ahora = new Date(), forzar = false } = {}) {
  if (!config.groups.cierre.enabled) return { enviados: 0 };
  if (!forzar && hourInBogota(ahora) !== config.groups.cierre.hour) return { enviados: 0 };

  const fecha = hoyEnBogota(ahora);
  const ventana = ventanaDelDia(fecha);
  const orgs = await organizations.listActive();

  let enviados = 0;
  for (const org of orgs) {
    try {
      const movidas = await radarCierres.movidasDelDia(org.id, ventana);
      if (movidas.length === 0) continue;

      // Lo que YA tiene resultado no se vuelve a preguntar. signalEvents es el
      // Learning Domain: Radar lo lee, nunca al reves (ver signal-events.js).
      const ultimos = await signalEvents.ultimoPorSenal(org.id, movidas.map((s) => s.id)).catch(() => new Map());
      const pendientes = movidas.filter((s) => !ultimos.has(s.id));
      if (pendientes.length === 0) continue;

      const principal = await advisors.findAsesorPrincipalRadar(org).catch(() => null);
      const porAsesora = agruparPorAsesora(pendientes, principal && principal.id);

      for (const [advisorId, señales] of porAsesora) {
        try {
          const advisor = await advisors.findById(org.id, advisorId);
          if (!advisor || !advisor.phone) continue;

          const cierre = cierreDia.armar(señales, advisor);
          // null = ninguna señal se pudo nombrar con una referencia. No se
          // manda un cierre vacio ni uno que hable de pedidos ajenos: eso es
          // exactamente el mensaje que este modulo vino a reemplazar.
          if (!cierre) continue;

          // Reclamo atomico por (org, asesora, fecha): dos corridas del mismo
          // dia no pueden mandar dos cierres. Si devuelve null, ya salio.
          const fila = await radarCierres.reclamar(org.id, advisorId, fecha, cierre.items);
          if (!fila) continue;

          const telefono = String(advisor.phone).replace(/\D/g, "");
          const { ok, error } = await mensajeAsesor.enviarYRegistrar(org, telefono, cierre.texto);
          if (ok) {
            await radarCierres.marcarEnviado(fila.id);
            // No frena este envio (es uno al dia, a hora fija), pero si cuenta
            // para que los avisos siguientes respeten el ritmo.
            ritmo.registrarEnvio(advisorId);
            enviados++;
          } else {
            // La fila queda con enviado_at null a proposito: asi ese dia se ve
            // como "se armo y no se pudo entregar". No se reintenta — si fallo
            // es casi siempre la ventana de 24h, y solo ella puede reabrirla.
            console.warn(`[cierre-dia] No se pudo mandar el cierre a ${advisor.name}:`, error);
          }
        } catch (e) {
          console.error("[cierre-dia] error con la asesora", advisorId, e.message);
        }
      }
    } catch (e) {
      console.error("[cierre-dia] error en la org", org.name, e.message);
    }
  }

  if (enviados) console.log(`[cierre-dia] ${enviados} cierre(s) enviado(s)`);
  return { enviados };
}

function start() {
  if (!config.groups.cierre.enabled) {
    console.log("[cierre-dia] deshabilitado (RADAR_CIERRE_ENABLED=false)");
    return;
  }
  // Se chequea cada 15 min y solo actua en la hora configurada, mismo patron
  // que group-digest: un setTimeout calculado al arranque se desfasa si el
  // proceso se reinicia, y Railway reinicia en cada despliegue.
  const ms = 15 * 60 * 1000;
  setTimeout(() => runOnce().catch((e) => console.error("[cierre-dia] runOnce:", e.message)), 60 * 1000);
  setInterval(() => runOnce().catch((e) => console.error("[cierre-dia] runOnce:", e.message)), ms);
  console.log(`[cierre-dia] activo — todos los dias a las ${config.groups.cierre.hour}:00 hora Colombia`);
}

module.exports = { start, runOnce, ventanaDelDia, agruparPorAsesora };
