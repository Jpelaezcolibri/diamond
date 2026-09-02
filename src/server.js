const express = require("express");
const config = require("./config");
const whatsapp = require("./channels/whatsapp");
const telegram = require("./channels/telegram");
const organizations = require("./data/organizations");
const leads = require("./data/leads");
const conversations = require("./data/conversations");
const { procesarMensaje } = require("./agent/engine");
const { enqueue } = require("./lib/user-queue");

const app = express();
// verify: conserva el body crudo en req.rawBody para poder validar la firma
// HMAC de Meta (X-Hub-Signature-256) en el webhook de WhatsApp — el hash se
// calcula sobre los bytes exactos que Meta envio, no sobre el JSON re-serializado.
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

app.use(whatsapp);
// Sin TELEGRAM_TOKEN el canal no tiene forma de responder; montarlo igual
// solo expone una ruta que procesa mensajes sin poder confirmar el secret
// token de forma util (ver channels/telegram.js).
if (config.telegramToken) app.use(telegram);
// Escucha en vivo de grupos gremiales. DOS condiciones para montarse, y las dos
// son interruptores reales: sin el secreto el webhook no podria autenticar a
// nadie, y sin GROUPS_ENABLED=true el canal queda fuera del proceso — no es un
// flag que el codigo consulte despues, la ruta no existe.
//
// Es deliberadamente mas dificil de encender que de apagar: quitar cualquiera
// de las dos variables y redesplegar deja el radar sordo y mudo.
if (config.groups.webhookSecret && config.groups.enabled) {
  app.use(require("./channels/whatsapp-group"));
  console.log(`[grupos] Escucha en vivo montada (modo de respuesta: ${config.groups.respuestaModo}).`);
}
// assistant antes que crm: el middleware "/api" de crm.js matchea tambien
// /api/assistant/* y exige Supabase; montar assistant primero deja que su
// propio guard maneje la ruta sin acoplarse a crm.js.
app.use(require("./api/assistant"));
app.use(require("./api/crm"));

app.get("/", (req, res) => {
  res.json({ ok: true, service: "bot-inmobiliario", mode: config.supabaseUrl ? "supabase" : "demo-memoria" });
});

// ── Endpoints de prueba local (sin WhatsApp ni Telegram) ─────────
// Exponen lectura/escritura arbitraria de leads por telefono: sin proteger,
// cualquiera con la URL puede leer PII de un lead real o borrar sus datos.
// Mismo guard x-api-key que usa el CRM (src/api/crm.js). Si BOT_API_KEY no
// esta configurado (dev local sin CRM) quedan abiertos, igual que hoy.
function requireTestApiKey(req, res, next) {
  if (!config.botApiKey) return next();
  if (req.headers["x-api-key"] !== config.botApiKey) {
    return res.status(401).json({ error: "API key invalida" });
  }
  next();
}

app.post("/test", requireTestApiKey, async (req, res) => {
  const { phone = "test_user", message, adReferral } = req.body;
  if (!message) return res.status(400).json({ error: "Falta el campo 'message'" });
  try {
    const org = await organizations.getDefault();
    // Misma cola por usuario que los canales reales (ver src/lib/user-queue.js)
    // — dos POST /test seguidos al mismo phone no deben intercalarse.
    const { reply, lead, transfer } = await enqueue(`${org.id}:${phone}`, () =>
      procesarMensaje({
        org,
        phone,
        text: message,
        source: "test",
        adReferral: adReferral || null,
      })
    );
    res.json({ reply, lead, transfer });
  } catch (e) {
    console.error("[test] Error:", e);
    res.status(500).json({ error: e.message });
  }
});

app.delete("/test/:phone", requireTestApiKey, async (req, res) => {
  try {
    const org = await organizations.getDefault();
    const lead = await leads.findOrCreate(org.id, req.params.phone, "test");
    await conversations.resetForLead(lead.id);
    await leads.update(lead.id, {
      nombre: null, presupuesto: null, zona_interes: null, tipo_interes: null,
      urgencia: null, score: 0, estado: "nuevo", property_ref_origen: null,
    });
    res.json({ ok: true, message: "Conversacion y lead reiniciados" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(config.port, () => {
  const modo = config.supabaseUrl ? "Supabase" : "DEMO en memoria (sin SUPABASE_URL)";
  console.log(`Bot inmobiliario corriendo en puerto ${config.port} — datos: ${modo}`);
  // Temporizador de recordatorios de cita (solo con base real: en modo demo
  // no hay citas persistidas que recordar).
  if (config.supabaseUrl) require("./scheduler/reminders").start();
  if (config.supabaseUrl) require("./scheduler/followups").start();
  // Digest diario del radar de grupos: lo que entro por export o por reenvio
  // no le sirve a nadie si hay que abrir el CRM para verlo.
  if (config.supabaseUrl) require("./scheduler/group-digest").start();
  // Vigila el radar en vivo y el inventario. Los fallos de este ecosistema son
  // silenciosos: el baneo de julio se descubrio porque Juan abrio una pantalla,
  // y el sync de Wasi se salteo cinco dias seguidos sin dejar mas rastro que un
  // hueco en una tabla. Avisa por la linea OFICIAL de Sofi, nunca por la
  // vinculada — si lo que se cayo es esa linea, avisar por ahi no serviria.
  if (config.supabaseUrl) require("./scheduler/radar-watchdog").start();
  // Calienta el directorio de colegas (lid -> telefono) al arrancar y cada
  // hora, para que el DM automatico no dependa de una llamada a WAHA en el
  // momento del pedido (Juan, 2026-09-02: 0 telefonos guardados en una semana
  // con el mismo codigo que resolvia el 80% en frio).
  if (config.supabaseUrl) require("./scheduler/radar-directorio").start();
  // A QUIEN LE LLEGAN LOS AVISOS (Juan, 2026-09-02: "me estan llegando a mi
  // los mensajes y necesito que les llegue a natalia y a catherine"). El
  // destino real de un aviso es la asesora de la rotacion; RADAR_ALERTA_TO
  // suma copias para calibrar, y esas copias NO quedan registradas como
  // conversacion, asi que no se ven en el CRM ni en ningun informe: el unico
  // sintoma es que a alguien le llegan mensajes que no le tocan. Se dice en
  // el arranque para que un numero olvidado ahi no pase otro mes inadvertido.
  const copiasRadar = (process.env.RADAR_ALERTA_TO || "").split(",").map((t) => t.trim()).filter(Boolean);
  if (copiasRadar.length > 0) {
    console.warn(
      `[radar] OJO: ademas de la asesora, cada aviso se copia a ${copiasRadar.length} numero(s) por RADAR_ALERTA_TO ` +
        `(${copiasRadar.map((t) => `***${t.slice(-4)}`).join(", ")}). Vaciar esa variable para que solo lo reciba la asesora.`
    );
  }
  // Empuja a la asesora a responder el aviso de un pedido del radar: sirve
  // para calibrar (signal_events) y renueva la ventana de 24h de los avisos
  // siguientes.
  if (config.supabaseUrl) require("./scheduler/radar-recordatorio").start();
  // Escalado a Catherine si Natalia (asesor PRINCIPAL del radar) no responde
  // el aviso a tiempo, en los dos carriles (venta y compra) — Juan, 2026-08-26.
  if (config.supabaseUrl) require("./scheduler/radar-silencio").start();
  // Bandeja de salida: junta lo pendiente y le manda a cada asesora un solo
  // mensaje agrupado en vez de uno por oportunidad (Juan, 2026-09-02).
  if (config.supabaseUrl) require("./scheduler/avisos-salida").start();
  // Cruce diario visitas -> ventas (Juan, 2026-08-21): de lo que el sistema
  // pudo capturar como visita agendada, ¿cual propiedad ya no esta
  // disponible? "quiero tener el control de las visitas y ventas".
  if (config.supabaseUrl) require("./scheduler/visitas-venta").start();
});
