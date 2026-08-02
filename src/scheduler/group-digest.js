// Digest diario del radar de grupos.
//
// El import y el reenvio dejan señales en la base, pero nadie vive mirando el
// CRM. Este worker cierra el circuito: una vez al dia, temprano, le dice a
// cada asesor cuantos pedidos de colegas calzan con el inventario y cuantas
// propiedades nuevas entraron a la red.
//
// POR QUE UNA PLANTILLA Y NO TEXTO LIBRE. A las 7am casi nunca hay una ventana
// de 24h abierta con el asesor, y fuera de esa ventana Meta rechaza el texto
// libre — es exactamente el problema que documenta
// scripts/enviar-demandas-pendientes.js. La plantilla lleva el resumen; el
// detalle completo se pide respondiendo, y esa respuesta abre la ventana.
//
// POR QUE NO MANDA EL DETALLE COMPLETO. Los parametros de plantilla de Meta no
// admiten saltos de linea, asi que quince señales no caben. Y aunque cupieran:
// un muro de texto a las 7am se ignora igual que los mil mensajes del grupo,
// que es justo lo que este producto viene a resolver.

const config = require("../config");
const organizations = require("../data/organizations");
const advisors = require("../data/advisors");
const groupSignals = require("../data/group-signals");
// Se importa el MODULO y no la funcion suelta: destructurar congela la
// referencia y deja los tests sin forma de mockear el envio — que ademas
// significa que un test correria contra la Graph API de verdad. Mismo criterio
// que src/groups/recomendar.js.
const canalWhatsapp = require("../channels/whatsapp");
const { hourInBogota } = require("./followups");

// Un digest por org por dia. En memoria alcanza: si el proceso se reinicia, el
// claim de digest_enviado_at en la base es lo que evita el duplicado de verdad.
const enviadoHoy = new Map();
let columnaFaltante = false;

function hoyEnBogota(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(date);
}

// La linea destacada de la plantilla. Es lo unico que el asesor lee antes de
// decidir si abre el detalle, asi que va el mejor match concreto y no un
// resumen abstracto.
function lineaDestacada(señales) {
  const conMatch = señales
    .filter((s) => s.clase === "demanda" && (s.matches || []).length > 0)
    .sort((a, b) => (b.matches[0]?.puntaje || 0) - (a.matches[0]?.puntaje || 0));

  if (conMatch.length > 0) {
    const s = conMatch[0];
    const m = s.matches[0];
    const que = [s.tipo, s.zona].filter(Boolean).join(" en ") || "algo";
    const ref = m.ref ? `ref ${m.ref}` : "una propiedad";
    return `${s.autor_nombre || "Un colega"} busca ${que} y tenemos ${ref}`;
  }

  const ofertas = señales.filter((s) => s.clase === "oferta");
  if (ofertas.length > 0) {
    const s = ofertas[0];
    const que = [s.tipo, s.zona].filter(Boolean).join(" en ") || "una propiedad";
    return `Entraron propiedades nuevas a la red, entre ellas ${que}`;
  }
  return "Hay movimiento nuevo en los grupos";
}

// Devuelve null si no hay nada que valga la pena contar. El silencio es
// deliberado: un digest vacio todos los dias entrena a ignorar el canal.
function buildDigest(señales, advisor) {
  const demandas = señales.filter((s) => s.clase === "demanda" && (s.matches || []).length > 0);
  const ofertas = señales.filter((s) => s.clase === "oferta");
  if (demandas.length === 0 && ofertas.length === 0) return null;

  return {
    bodyParams: [
      (advisor.name || "").split(" ")[0] || "Hola",
      String(demandas.length),
      String(ofertas.length),
      lineaDestacada(señales),
    ],
    ids: señales.map((s) => s.id),
    demandas: demandas.length,
    ofertas: ofertas.length,
  };
}

// Los mismos elegibles que reciben transferencias: quien recibe leads es quien
// puede actuar sobre un match. El admin lo ve todo en el CRM.
async function destinatarios(orgId) {
  return advisors.listElegibles(orgId);
}

async function runOnce({ ahora = new Date(), forzar = false } = {}) {
  if (columnaFaltante) return { enviados: 0 };
  if (!forzar && hourInBogota(ahora) !== config.groups.digest.hour) return { enviados: 0 };

  const dia = hoyEnBogota(ahora);
  let enviados = 0;

  // listActive y no getDefault: el digest es multi-tenant desde el dia uno.
  for (const org of await organizations.listActive()) {
    if (!forzar && enviadoHoy.get(org.id) === dia) continue;

    try {
      const señales = await groupSignals.pendientesDigest(org.id);
      if (señales === null) {
        columnaFaltante = true;
        console.warn(
          "[digest] group_signals.digest_enviado_at no existe — correr la migracion " +
          "2026-08-01_radar_grupos.sql. Worker desactivado."
        );
        return { enviados };
      }
      if (señales.length === 0) {
        enviadoHoy.set(org.id, dia);
        continue;
      }

      const equipo = config.groups.digest.to.length > 0
        ? config.groups.digest.to.map((phone) => ({ name: "Prueba", phone }))
        : await destinatarios(org.id);

      if (equipo.length === 0) {
        console.warn(`[digest] ${org.name}: hay ${señales.length} señales pero ningun asesor elegible.`);
        enviadoHoy.set(org.id, dia);
        continue;
      }

      const digest = buildDigest(señales, equipo[0]);
      if (!digest) {
        enviadoHoy.set(org.id, dia);
        continue;
      }

      // Claim ANTES de enviar: duplicar el digest entrena a ignorarlo,
      // perderlo una vez no. Mismo criterio que reminders y followups.
      await groupSignals.marcarDigest(org.id, digest.ids);

      let ok = 0;
      for (const advisor of equipo) {
        const propio = buildDigest(señales, advisor);
        const r = await canalWhatsapp.sendWhatsAppTemplate(org, advisor.phone, {
          name: config.groups.digest.templateName,
          language: config.groups.digest.templateLang,
          bodyParams: propio.bodyParams,
        });
        if (r?.ok) ok++;
        else console.error(`[digest] No salio para ${advisor.name}: ${r?.error || "sin detalle"}`);
      }

      if (ok === 0) {
        // Nadie lo recibio: lo mas probable es que la plantilla no este
        // aprobada todavia. Se devuelven las señales a la fila para el
        // proximo dia en vez de perderlas en silencio.
        await groupSignals.revertirDigest(org.id, digest.ids);
        console.error(`[digest] ${org.name}: ningun envio salio, señales devueltas a la fila.`);
      } else {
        enviados += ok;
        enviadoHoy.set(org.id, dia);
        console.log(
          `[digest] ${org.name}: ${ok}/${equipo.length} asesores — ` +
          `${digest.demandas} pedidos con match, ${digest.ofertas} propiedades nuevas.`
        );
      }
    } catch (e) {
      console.error(`[digest] error en ${org.name}:`, e.message);
    }
  }

  return { enviados };
}

function start() {
  if (!config.groups.digest.enabled) {
    console.log("[digest] deshabilitado (GROUPS_DIGEST_ENABLED=false)");
    return;
  }
  const ms = config.groups.digest.intervalMin * 60 * 1000;
  const tick = () => runOnce().catch((e) => console.error("[digest] runOnce:", e.message));
  setTimeout(tick, 60 * 1000);
  setInterval(tick, ms);
  console.log(
    `[digest] activo — ${config.groups.digest.hour}h Colombia, revisa cada ` +
    `${config.groups.digest.intervalMin} min, plantilla "${config.groups.digest.templateName}"`
  );
}

function _reset() {
  enviadoHoy.clear();
  columnaFaltante = false;
}

module.exports = { start, runOnce, buildDigest, lineaDestacada, destinatarios, hoyEnBogota, _reset };
