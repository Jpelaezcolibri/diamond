// Cruce diario: de las visitas/avances que el sistema pudo capturar (cliente
// directo con Sofi, o colega con avance en la linea de Natalia), ¿cual
// propiedad ya no esta disponible?
//
// Juan, 2026-08-21: "que todos los dias se haga el barrido con wasi y se
// cruce que propiedades se vendieron de esas visitas agendadas... quiero
// tener el control de las visitas y ventas por eso quiero crear todo un
// sistema de seguimiento automatizado para poder identificar cada venta que
// se realiza".
//
// NO afirma "esto se vendio por el bot": marca "posible venta, revisar" — una
// propiedad puede dejar de estar disponible por muchas razones (se retiro, se
// vendio por otro medio, error de carga). El veredicto final lo pone Juan; el
// aviso le pide exactamente eso.
//
// Corre una vez al dia, temprano — despues de que el sync de Wasi (DMAP, otro
// servicio) ya actualizo `properties.disponible` para hoy.

const organizations = require("../data/organizations");
const properties = require("../data/properties");
const visitas = require("../data/visitas");
const mensajeAsesor = require("../lib/mensaje-asesor");
const { hourInBogota } = require("./followups");

const HORA = Number(process.env.VISITAS_VENTA_HORA || 8);
// Mismo destinatario que el inbox de la linea de Natalia (src/groups/dm.js):
// es la misma pregunta de fondo, "¿esto avanzo hacia una venta?".
const ALERTA_TO = process.env.RADAR_VISITAS_ALERTA_TO || "";

function construirAlerta(ref, prop, visita) {
  const cuando = new Date(visita.fechaHoraIso).toLocaleString("es-CO", {
    timeZone: "America/Bogota", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  });
  return [
    `💰 Posible venta: una propiedad con visita agendada ya no esta disponible`,
    ``,
    `Ref ${ref} — ${prop.titulo || "sin título"}`,
    `Visita con: ${visita.quien} (${visita.origen === "cliente" ? "cliente directo" : "colega de otra inmobiliaria"})`,
    `Fecha de la visita: ${cuando}`,
    ``,
    `Confirmame si esta venta fue por el bot para llevar el conteo.`,
  ].join("\n");
}

async function runOnce({ ahora = new Date(), forzar = false } = {}) {
  if (!forzar && hourInBogota(ahora) !== HORA) return { revisadas: 0, alertadas: 0 };
  if (!ALERTA_TO) return { revisadas: 0, alertadas: 0 };

  let revisadas = 0;
  let alertadas = 0;

  for (const org of await organizations.listActive()) {
    try {
      const filas = await visitas.recientes(org.id, { dias: 30 });
      // Una fila por REF: si hubo varias visitas al mismo inmueble, la
      // primera que se encuentra alcanza para el cruce.
      const porRef = new Map();
      for (const v of filas) if (v.ref && !porRef.has(v.ref)) porRef.set(v.ref, v);
      revisadas += porRef.size;

      for (const [ref, visita] of porRef) {
        const prop = await properties.findByRef(org.id, ref).catch(() => null);
        if (!prop || prop.disponible !== false) continue;

        if (await visitas.yaAlertada(org.id, ref)) continue;

        const texto = construirAlerta(ref, prop, visita);
        const envio = await mensajeAsesor.enviarYRegistrar(org, ALERTA_TO, texto).catch((e) => ({ ok: false, error: e.message }));
        if (envio && envio.ok) {
          await visitas.marcarAlertada(org.id, ref, visita);
          alertadas++;
        } else {
          console.error(`[visitas-venta] No se pudo avisar la posible venta de ${ref}:`, envio && envio.error);
        }
      }
    } catch (e) {
      console.error(`[visitas-venta] error en ${org.name}:`, e.message);
    }
  }

  return { revisadas, alertadas };
}

function start() {
  if (!ALERTA_TO) {
    console.log("[visitas-venta] deshabilitado (sin RADAR_VISITAS_ALERTA_TO)");
    return;
  }
  const tick = () => runOnce().catch((e) => console.error("[visitas-venta] runOnce:", e.message));
  setTimeout(tick, 90 * 1000);
  setInterval(tick, 30 * 60 * 1000);
  console.log(`[visitas-venta] activo — revisa a las ${HORA}h Colombia`);
}

module.exports = { start, runOnce, construirAlerta };
