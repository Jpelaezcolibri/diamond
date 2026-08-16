// Vigila que el radar en vivo siga vivo, y avisa cuando no.
//
// POR QUE EXISTE. El baneo del 2026-07-30 se descubrio porque Juan abrio una
// pantalla. DMAP estuvo 16 dias detenido sin que nadie se enterara. Y el sync de
// Wasi se salteo cinco dias seguidos en agosto sin dejar mas rastro que un hueco
// en una tabla que nadie mira.
//
// El patron se repite: los fallos de este ecosistema son SILENCIOSOS. No tiran
// el servicio, no llenan los logs de rojo; simplemente dejan de hacer lo suyo y
// todo lo demas sigue como si nada.
//
// Con el reintento manual (2026-08-16) esto pesa mas que antes: una sesion que
// se cae YA NO se levanta sola, asi que sin este aviso el radar queda mudo hasta
// que alguien se acuerde de mirar.
//
// COMO AVISA. Por la linea OFICIAL de Sofi (Cloud API de Meta), nunca por la
// linea vinculada: si lo que se cayo es justamente esa linea, avisar por ahi
// seria pedirle al muerto que avise de su muerte.
//
// NO INTENTA ARREGLAR NADA. Detecta y avisa. Levantar la sesion es una decision
// de una persona — ver src/lib/waha.js sobre por que no hay reintento
// automatico.

const config = require("../config");
const organizations = require("../data/organizations");
const syncEstado = require("../data/sync-estado");
const whatsappGroups = require("../data/whatsapp-groups");
const waha = require("../lib/waha");
// Se importa el MODULO y no la funcion suelta: destructurar congela la
// referencia y deja los tests sin forma de mockear el envio — lo que ademas
// significa que un test correria contra la Graph API de verdad.
const canalWhatsapp = require("../channels/whatsapp");

const INTERVALO_MIN = Number(process.env.RADAR_WATCHDOG_INTERVAL_MIN || 30);

// A quien se le avisa. Sin esto configurado el watchdog no arranca: un vigilante
// que no tiene a quien llamar no es un vigilante.
const DESTINO = (process.env.RADAR_WATCHDOG_TO || "").split(",").map((t) => t.trim()).filter(Boolean);

// Estados de WAHA que significan "el radar no esta escuchando".
const ESTADOS_CAIDOS = new Set(["FAILED", "STOPPED", "ERROR"]);

// Para no repetir el mismo aviso cada media hora. Se recuerda el ultimo problema
// notificado por clave; cuando cambia (o se resuelve) vuelve a avisar.
const avisado = new Map(); // clave -> texto del ultimo aviso

let timer = null;

async function revisar(ahora = new Date()) {
  const problemas = [];

  let org;
  try {
    org = await organizations.getDefault();
  } catch (e) {
    console.error("[watchdog] No se pudo resolver la organizacion:", e.message);
    return problemas;
  }

  // ── 1. La sesion vinculada ──────────────────────────────────────────
  // Solo si el canal esta montado: si el radar en vivo esta apagado, que no
  // haya sesion es lo esperado y no es noticia.
  if (config.groups.enabled && waha.configurado()) {
    try {
      const sesiones = await whatsappGroups.listSessions(org.id);
      for (const s of sesiones) {
        const estado = await waha.estadoSesion(s.nombre).catch((e) => ({ status: "ERROR", error: e.message }));
        if (ESTADOS_CAIDOS.has(estado?.status)) {
          problemas.push({
            clave: `sesion:${s.nombre}`,
            texto:
              `El radar dejo de escuchar: la sesion "${s.nombre}" esta en ${estado.status}. ` +
              `No se levanta sola. Entra al CRM > Grupos y toca "Reintentar una vez".`,
          });
        }
      }
    } catch (e) {
      console.error("[watchdog] No se pudo revisar las sesiones:", e.message);
    }
  }

  // ── 2. La frescura del inventario ───────────────────────────────────
  // Vale aunque el radar en vivo este apagado: un inventario viejo tambien
  // ensucia la landing, el digest y lo que Sofi le ofrece a un cliente.
  const inventario = await syncEstado.estadoDelInventario(org.id, { ahora });
  if (!inventario.fresco) {
    problemas.push({
      clave: "sync",
      texto: inventario.iso
        ? `El inventario esta viejo: el ultimo sync de Wasi fue hace ${inventario.horas} h. ` +
          `El radar no va a publicar nada hasta que corra. Sincroniza desde el CRM > Marketing.`
        : `No se pudo leer el estado del sync de Wasi. El radar no va a publicar nada.`,
    });
  }

  return problemas;
}

async function avisar(problemas) {
  const org = await organizations.getDefault().catch(() => null);
  if (!org) return;

  const vigentes = new Set(problemas.map((p) => p.clave));

  // Lo que se resolvio solo tambien se avisa: si no, quien recibio la alarma no
  // sabe nunca que puede dejar de preocuparse.
  for (const [clave] of avisado) {
    if (!vigentes.has(clave)) {
      avisado.delete(clave);
      await enviar(org, `Radar: se normalizo lo de "${clave}".`);
    }
  }

  for (const p of problemas) {
    if (avisado.get(p.clave) === p.texto) continue; // ya avisado, sin novedad
    avisado.set(p.clave, p.texto);
    await enviar(org, `⚠️ ${p.texto}`);
  }
}

async function enviar(org, texto) {
  for (const to of DESTINO) {
    const r = await canalWhatsapp.sendWhatsApp(org, to, texto).catch((e) => ({ ok: false, error: e.message }));
    if (!r || !r.ok) {
      // Si el aviso no sale, por lo menos que quede en el log del servicio.
      console.error(`[watchdog] NO se pudo avisar a ${to}: ${r && r.error}. Mensaje: ${texto}`);
    }
  }
  if (DESTINO.length === 0) console.warn(`[watchdog] ${texto}`);
}

async function tick() {
  try {
    await avisar(await revisar());
  } catch (e) {
    console.error("[watchdog] fallo la revision:", e.message);
  }
}

function start() {
  if (DESTINO.length === 0) {
    console.warn(
      "[watchdog] RADAR_WATCHDOG_TO esta vacio: no arranca. " +
      "Un vigilante sin a quien avisar no sirve de nada."
    );
    return null;
  }
  if (timer) return timer;
  timer = setInterval(tick, INTERVALO_MIN * 60 * 1000);
  // Primera revision al arrancar, sin esperar el intervalo: si el deploy se hizo
  // justo para arreglar algo, se quiere saber ya si quedo bien.
  tick();
  console.log(`[watchdog] Vigilando el radar cada ${INTERVALO_MIN} min; avisa a ${DESTINO.length} numero(s).`);
  return timer;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  avisado.clear();
}

module.exports = { start, stop, revisar, avisar, INTERVALO_MIN, _avisado: avisado };
