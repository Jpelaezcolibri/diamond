// Manda un WhatsApp a un asesor Y lo deja guardado como mensaje real, con el
// mismo mecanismo que usa el chat normal (leads + conversations + messages).
//
// POR QUE EXISTE. Hasta el 2026-08-18, los avisos del radar (src/groups/vivo.js)
// y los mensajes de Sofi-Comando (enviar_whatsapp_equipo) se mandaban con
// canalWhatsapp.sendWhatsApp DIRECTO — sin pasar por el sistema de
// conversaciones. Salian y se olvidaban: no quedaba ningun registro mas alla
// de "algo se envio". Juan lo encontro pidiendo ver, en el Inbox, la prueba
// tecnica que se le habia mandado a Catherine y el intento de reenvio de
// Sofi — y no estaban en ningun lado, porque nunca se habian guardado.
//
// Con esto, CUALQUIER mensaje que Sofi le mande a un asesor —radar,
// Sofi-Comando, recordatorios— queda en la misma conversacion que ya usa el
// chat normal, visible como cualquier otro hilo (ver el panel "Equipo" del
// CRM, que filtra por leads.source = "asesor").
const leads = require("../data/leads");
const conversations = require("../data/conversations");
// Modulo y no funcion suelta: destructurar congela la referencia y deja los
// tests sin forma de mockear el envio (mismo criterio que src/groups/vivo.js).
const canalWhatsapp = require("../channels/whatsapp");
const advisors = require("../data/advisors");

// ALERTA DE ENVIO FALLIDO (Juan, 2026-08-21 — caso Natalia/radar: 7 avisos
// seguidos quedaron en `delivery: sent` porque Meta acepta el POST y nosotros
// IGNORAMOS a proposito los acuses de entrega/lectura que llegan despues por
// webhook (ver src/channels/whatsapp.js, `if (value?.statuses) return`). Un
// mensaje que Meta rechaza silenciosamente mas tarde, o que nunca llega
// porque la ventana de 24h con ESE numero esta cerrada, se veia igual que uno
// que si llego — hasta que el asesor decia "a mi no me llego nada".
//
// Esto no arregla el hueco de fondo (seguimos sin leer los `statuses`), pero
// cierra el caso mas comun y mas detectable: la Graph API SI devuelve un
// error sincronico cuando la ventana esta cerrada (via ese numero no escribio
// en las ultimas 24h). Reusa RADAR_WATCHDOG_TO — el mismo numero de Juan que
// ya usa src/scheduler/radar-watchdog.js para todo lo demas que falla
// silencioso en este ecosistema.
const ADMIN_ALERTA_TO = (process.env.RADAR_WATCHDOG_TO || "").split(",").map((t) => t.trim()).filter(Boolean);
const VENTANA_CERRADA = /24\s*hours?|24\s*horas?|re-?engagement|131047/i;

async function avisarFalloEnvio(org, telefono, texto, error) {
  if (ADMIN_ALERTA_TO.length === 0) return;
  const motivo = VENTANA_CERRADA.test(error || "")
    ? "la ventana de 24h con ese numero esta cerrada (no te escribio en las ultimas 24h, asi que WhatsApp no deja mandarle texto libre)"
    : `error: ${error || "sin detalle"}`;
  const recorte = texto.length > 200 ? `${texto.slice(0, 200)}...` : texto;
  const aviso = `⚠️ No se pudo mandar un WhatsApp a +${telefono}: ${motivo}.\n\nMensaje que no salio:\n"${recorte}"`;
  for (const to of ADMIN_ALERTA_TO) {
    if (to === telefono) continue; // no alertar al mismo numero que ya fallo
    const r = await canalWhatsapp.sendWhatsApp(org, to, aviso).catch((e) => ({ ok: false, error: e.message }));
    if (!r || !r.ok) console.error(`[mensaje-asesor] tampoco se pudo avisar del fallo a ${to}: ${r && r.error}`);
  }
}

/**
 * @param org       organizacion resuelta
 * @param telefono  numero del asesor, solo digitos
 * @param texto     el mensaje a mandar (o el cuerpo, si va con botones)
 * @param opts.botones  [{id, title}] — si vienen, se manda como mensaje
 *   interactivo (ver canalWhatsapp.sendWhatsAppButtons) en vez de texto
 *   libre. El `texto` completo igual queda guardado como contenido del
 *   mensaje, para que el Inbox del CRM muestre lo mismo que via en el chat.
 * @returns { ok, wamid, error } — mismo shape que canalWhatsapp.sendWhatsApp
 */
// NUNCA DESTINATARIO (Juan, 2026-09-02): "mi numero 3016981200 retiralo de
// cualquier bug que este por que me estan llegando mensajes y eso hace que la
// linea se vuelva mas vulnerable".
//
// El criterio no es una lista negra con su numero adentro —eso seria justo el
// hardcodeo de datos de Diamond que este repo no permite— sino una regla:
// un asesor DADO DE BAJA no recibe mensajes. El numero de Juan esta en
// `advisors` con activo=false desde julio, igual que "Asesor Prueba QA" y las
// dos filas viejas de Catherine y Claudia. Cualquiera de esos numeros podia
// recibir un aviso si alguien lo ponia en un env var de copia
// (RADAR_ALERTA_TO, RADAR_WATCHDOG_TO) o si un bug lo elegia como destino.
//
// Se resuelve por organizacion, se mantiene solo (quien se va del equipo deja
// de recibir sin tocar codigo) y degrada abierto: si la consulta falla, se
// manda igual, porque perder un aviso es peor que mandarlo de mas.
async function estaDadoDeBaja(org, telefono) {
  const a = await advisors.findByPhone(org.id, telefono).catch(() => null);
  return Boolean(a && a.activo === false);
}

// CANDADO ANTI-DUPLICADO (Juan, 2026-09-02): "quiero que me quites los
// mensajes repetidos".
//
// EL CASO REAL. El 2 de septiembre a las 12:30 pm Natalia recibio DOS veces
// identico el mismo aviso del radar (David Holguin, grupo PEDIDOS 7:00A.M.),
// con 0,26 segundos de diferencia. Ocho duplicados asi en 13 dias.
//
// La deduplicacion por señal YA existe y funciona (indice unico
// idx_group_signals_dedup): el segundo insert recibe 23505 y el flujo corta.
// Aun asi salieron dos mensajes, o sea que el envio repetido no viene del
// camino que esa dedup cubre —queda un proceso viejo escribiendo contra la
// misma base (ver diamond-os/), un webhook reintentado, o un camino que no
// pasa por la señal.
//
// Por eso el candado NO va en el radar sino aca, en el unico punto por el que
// pasan todos los mensajes a un asesor: si ese mismo texto ya salio a ese
// mismo numero hace menos de MINUTOS_ANTIDUPLICADO, no se manda de nuevo.
// Cubre cualquier causa, presente o futura, incluida una que todavia no
// diagnosticamos.
//
// Por que es seguro: por aca solo pasan avisos del radar y mensajes de
// Sofi-Comando, que son textos largos y unicos. Las respuestas conversacionales
// de Sofi —donde repetir "Decime, Natalia." a los dos minutos SI es legitimo—
// no usan esta funcion: salen por src/agent/engine.js.
const MINUTOS_ANTIDUPLICADO = Number(process.env.AVISOS_ANTIDUPLICADO_MIN || 10);

async function yaSalioIgual(convId, texto) {
  if (!(MINUTOS_ANTIDUPLICADO > 0)) return false;
  const recientes = await conversations.ultimosSalientes(convId, 15).catch(() => []);
  const corte = Date.now() - MINUTOS_ANTIDUPLICADO * 60 * 1000;
  return (recientes || []).some(
    (m) =>
      m.role === "assistant" &&
      m.content === texto &&
      new Date(m.created_at).getTime() >= corte
  );
}

async function enviarYRegistrar(org, telefono, texto, opts = {}) {
  if (await estaDadoDeBaja(org, telefono)) {
    console.warn(`[mensaje-asesor] ${telefono} es un asesor dado de baja — no se le manda nada.`);
    return { ok: false, wamid: null, error: "asesor_inactivo", bloqueado: true };
  }

  const lead = await leads.findOrCreate(org.id, telefono, "asesor");
  const conv = await conversations.findOrCreate(org.id, lead.id, null);

  // Antes de escribir el mensaje: si ya salio identico hace un momento, este
  // es el duplicado y no debe existir ni siquiera como fila.
  if (!opts.permitirRepetido && (await yaSalioIgual(conv.id, texto))) {
    console.warn(`[mensaje-asesor] mensaje identico a ${telefono} hace menos de ${MINUTOS_ANTIDUPLICADO} min — no se repite.`);
    return { ok: true, wamid: null, duplicado: true };
  }
  // Se guarda ANTES de mandar: si el envio revienta antes de responder (timeout,
  // red caida), el mensaje que se INTENTO mandar sigue siendo mas util que nada
  // — es lo mismo que ya hace src/agent/engine.js con la respuesta del cliente.
  const msg = await conversations.appendMessage(conv.id, "assistant", texto);

  const envio = opts.botones
    ? await canalWhatsapp.sendWhatsAppButtons(org, telefono, texto, opts.botones).catch((e) => ({ ok: false, error: e.message }))
    : await canalWhatsapp.sendWhatsApp(org, telefono, texto).catch((e) => ({ ok: false, error: e.message }));
  if (msg?.id) {
    await conversations.setDelivery(msg.id, envio && envio.ok ? "sent" : "failed", envio && envio.error);
    if (envio && envio.wamid) await conversations.setWaMessageId(msg.id, envio.wamid);
  }
  if (!envio || !envio.ok) {
    if (!opts.silenciarAlertaWatchdog) await avisarFalloEnvio(org, telefono, texto, envio && envio.error);
  }
  return envio || { ok: false, wamid: null, error: "sin_respuesta" };
}

// Se exporta VENTANA_CERRADA porque el carril de compra necesita distinguir
// "Meta rechazo por ventana cerrada" (donde la plantilla SI sirve) de cualquier
// otro fallo (donde no sirve de nada reintentar con plantilla).
module.exports = { enviarYRegistrar, VENTANA_CERRADA };
