// Mantiene abierta la ventana de 24h de Meta con la asesora del radar.
//
// POR QUE EXISTE (Juan, 2026-09-04: "y si desde la linea de natalia que la
// tenemos vinculada para enviar los mensajes le enviamos un mensajes a sofi
// todos los dias para abrir la ventana??").
//
// Meta solo entrega texto libre a quien le escribio al negocio en las ultimas
// 24h. Si Natalia no le escribe a Sofi, su ventana se cierra y TODOS los avisos
// del radar se pierden — ese mismo dia habia mensajes represados. Y no hay nada
// que podamos hacer desde nuestro lado para reabrirla: solo la reabre un
// mensaje ENTRANTE de ella. Las plantillas tapan el sintoma (el digest ya sale
// por plantilla justo por esto), pero cuestan y no sirven para el aviso puntual
// de un pedido que hay que atender en minutos.
//
// POR QUE FUNCIONA. El numero de Natalia ES la linea vinculada a WAHA: la misma
// fila de `advisors` y el mismo `me.id` de la sesion. O sea que ya controlamos
// esa linea por API. Si WAHA le manda un WhatsApp a Sofi desde ella, Meta ve un
// mensaje entrante suyo y la ventana se abre 24h. No es una evasion: es su
// propia linea de empresa escribiendole a su propio bot.
//
// LA GUARDA CRITICA. Todo lo anterior vale SOLO mientras la linea que
// controlamos sea la de ella. Antes de mandar se compara el `me.id` de la
// sesion de WAHA contra el telefono de la asesora; si no coinciden no sale
// nada. Mandar desde la linea del radar haciendose pasar por otra persona
// seria algo completamente distinto a que ella le escriba a su propio bot, y
// este archivo no puede quedar a un cambio de configuracion de hacerlo.
//
// APAGADO POR DEFECTO. Es un envio automatico desde una linea no oficial — la
// misma clase de linea que ya fue baneada el 2026-07-30. Se enciende a
// conciencia con VENTANA_ASESORA_ENABLED=true.
const config = require("../config");
const organizations = require("../data/organizations");
const advisors = require("../data/advisors");
const whatsappGroups = require("../data/whatsapp-groups");
const waha = require("../lib/waha");
const leads = require("../data/leads");
const conversations = require("../data/conversations");

// Tiene que ser OBVIAMENTE automatico: la asesora lo va a ver en SU propio
// WhatsApp como un mensaje que ella no escribio, y sin esta aclaracion lo
// razonable de su parte es asustarse (o creer que le clonaron la linea).
const TEXTO_VENTANA =
  "🔄 Mensaje automático para mantener abierto el canal con Sofi. No hace falta responder.";

// El numero OFICIAL de Sofi (Cloud API de Meta): es esa ventana —la de Meta— la
// que se quiere abrir, no la de la linea vinculada.
const NUMERO_SOFI = () => (process.env.CONTACT_WHATSAPP_NUMBER || "").trim();

let timer = null;

// Una sola sesion vinculada por org, igual que en src/groups/vivo.js: si hay
// cero o mas de una, falla cerrado en vez de adivinar por cual linea mandar.
async function sesionActiva(orgId) {
  const sesiones = await whatsappGroups.listSessions(orgId);
  const activas = (sesiones || []).filter((s) => s.estado === "activa");
  return activas.length === 1 ? activas[0].nombre : null;
}

// ¿La linea vinculada ES la de la asesora? `me.id` viene como
// "573001878024@c.us"; advisors.mismoTelefono compara por los ultimos 10
// digitos, que es lo unico estable entre los formatos que guarda `advisors` y
// el internacional sin signos que devuelve WhatsApp.
//
// Sin `me.id` devuelve false a proposito: no poder comprobar la guarda no es
// lo mismo que cumplirla.
async function lineaEsDeLaAsesora(sesion, telefonoAsesora) {
  const estado = await waha.estadoSesion(sesion).catch(() => null);
  const meId = estado && estado.me && estado.me.id;
  if (!meId) return false;
  return advisors.mismoTelefono(String(meId).split("@")[0], telefonoAsesora);
}

// ¿Escribio ella por su cuenta dentro de la ventana? Mismo camino que
// radar-silencio.js#nataliaRespondio: su lead de tipo "asesor" -> su
// conversacion -> ¿algun mensaje entrante despues del corte? Si lo hay, la
// ventana ya esta abierta y este worker no tiene nada que hacer.
async function ventanaAbierta(org, telefono, desdeIso) {
  const lead = await leads.findOrCreate(org.id, telefono, "asesor");
  const conv = await conversations.findOrCreate(org.id, lead.id, null);
  return conversations.hayMensajeEntranteDespues(conv.id, desdeIso);
}

// La cuota que pone WhatsApp sobre la linea, no nosotros (ver
// waha.cuotaDeLinea). Solo frena AGOTADA del todo: este mensaje es de un solo
// envio por dia y es justamente el que evita perder los avisos. Un null —no se
// pudo leer— no frena, mismo criterio que el resto del radar.
async function cuotaAgotada(sesion) {
  const cuota = await waha.cuotaDeLinea(sesion).catch(() => null);
  return Boolean(cuota && cuota.fraccion >= 1);
}

async function runParaOrg(org) {
  const asesora = await advisors.findAsesorPrincipalRadar(org).catch(() => null);
  if (!asesora || !asesora.phone) return { org: org.name, resultado: "sin_asesora" };

  const sesion = await sesionActiva(org.id).catch(() => null);
  if (!sesion) return { org: org.name, resultado: "sin_sesion" };

  if (!(await lineaEsDeLaAsesora(sesion, asesora.phone))) {
    return { org: org.name, resultado: "linea_no_es_de_la_asesora" };
  }

  const desdeIso = new Date(Date.now() - config.groups.ventanaAsesora.horas * 3600 * 1000).toISOString();
  if (await ventanaAbierta(org, asesora.phone, desdeIso)) {
    return { org: org.name, resultado: "ventana_abierta" };
  }

  if (await cuotaAgotada(sesion)) return { org: org.name, resultado: "cuota_agotada" };

  const r = await waha.enviarDm(sesion, NUMERO_SOFI(), TEXTO_VENTANA);
  if (!r || !r.ok) {
    console.warn(`[ventana-asesora] no se pudo abrir la ventana de ${asesora.name}: ${r && r.error}`);
    return { org: org.name, resultado: "fallo_envio" };
  }
  return { org: org.name, resultado: "enviado" };
}

async function runOnce() {
  const resultados = [];
  if (!config.groups.ventanaAsesora.enabled) return { sent: 0, resultados };

  let orgs;
  try {
    orgs = await organizations.listActive();
  } catch (e) {
    console.error("[ventana-asesora] no se pudieron listar las organizaciones:", e.message);
    return { sent: 0, resultados };
  }

  for (const org of orgs) {
    try {
      resultados.push(await runParaOrg(org));
    } catch (e) {
      // Best-effort como el resto de los schedulers: nada de esto puede tumbar
      // el proceso ni las corridas de las otras orgs.
      console.error("[ventana-asesora] error en", org.name, e.message);
      resultados.push({ org: org.name, resultado: "error" });
    }
  }

  const sent = resultados.filter((r) => r.resultado === "enviado").length;

  // OBSERVABILIDAD (Juan lo encendio en produccion el 2026-09-04). Hasta aca
  // esto solo logueaba cuando SE MANDABA algo, y por eso el caso mas comun
  // —"ventana_abierta", ella escribio sola, no hay nada que hacer— y el mas
  // grave —"linea_no_es_de_la_asesora": la guarda fallo y este worker no va a
  // mandar NUNCA— se veian exactamente igual: silencio absoluto.
  //
  // Con la guarda rota el worker parece sano mientras Natalia se queda sin
  // avisos, que es el modo de falla que este proyecto ya pago dos veces (el
  // sync de Wasi 16 dias detenido, los 7 avisos en `sent` que nunca llegaron).
  // Una linea por corrida es barata; descubrirlo dentro de una semana no.
  console.log(`[ventana-asesora] ${resultados.map((r) => `${r.org}=${r.resultado}`).join(" | ") || "sin orgs activas"}`);
  return { sent, resultados };
}

function start() {
  if (!config.groups.ventanaAsesora.enabled) {
    console.log("[ventana-asesora] apagado (VENTANA_ASESORA_ENABLED != true): no arranca.");
    return null;
  }
  if (!NUMERO_SOFI()) {
    // Sin a quien escribirle no hay ventana que abrir, y arrancar igual dejaria
    // un worker que falla en silencio — el modo de falla que este ecosistema ya
    // pago caro varias veces.
    console.warn("[ventana-asesora] CONTACT_WHATSAPP_NUMBER esta vacio: no arranca.");
    return null;
  }
  if (timer) return timer;
  const ms = config.groups.ventanaAsesora.intervalMin * 60 * 1000;
  timer = setInterval(() => runOnce().catch((e) => console.error("[ventana-asesora] runOnce:", e.message)), ms);
  // Primera corrida a los 50 s, escalonada respecto de los otros schedulers
  // para no pegarle a WAHA con todo junto al arrancar.
  setTimeout(() => runOnce().catch((e) => console.error("[ventana-asesora] runOnce:", e.message)), 50 * 1000);
  console.log(
    `[ventana-asesora] activo — cada ${config.groups.ventanaAsesora.intervalMin} min, ventana de ${config.groups.ventanaAsesora.horas} h`
  );
  return timer;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, runOnce, runParaOrg, lineaEsDeLaAsesora, TEXTO_VENTANA };
