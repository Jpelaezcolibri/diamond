// `override: true` para que un .env local mande sobre lo que ya haya en el
// ambiente. En produccion no cambia nada: Railway inyecta variables y no hay
// archivo .env que cargar.
//
// LA EXCEPCION, y por que existe (2026-09-05). Con `railway run` —el patron
// que usa este repo para probar contra produccion SIN copiar la clave— Railway
// inyecta las variables reales y este override las pisaba con las locales, en
// silencio. Resultado ese dia: una prueba de la API con "la clave de
// produccion" fallo por saldo, se diagnostico una caida de Sofi que NO estaba
// pasando, y hubo que rastrearlo hasta esta linea. scripts/smoke-cache.js ya
// esquivaba la trampa a mano ("la clave se captura ANTES de requerir nada de
// src/"), lo que confirma que muerde a cualquiera que la desconozca.
//
// Bajo `railway run` las variables inyectadas MANDAN: es exactamente lo que
// alguien pide al escribir ese comando.
const bajoRailway = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_ID);
require("dotenv").config({ override: !bajoRailway });

const config = {
  port: process.env.PORT || 3000,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  claudeModel: process.env.CLAUDE_MODEL || "claude-sonnet-4-5",

  // Supabase — si faltan, la capa de datos corre en modo demo (memoria)
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY || "",

  // Canales
  telegramToken: process.env.TELEGRAM_TOKEN || "",
  // Secret token registrado junto al webhook de Telegram (setWebhook con
  // secret_token). Sin el, cualquiera que conozca la URL puede simular
  // mensajes de cualquier chat_id. Ver src/channels/telegram.js.
  telegramSecretToken: process.env.TELEGRAM_SECRET_TOKEN || "",

  // API interna para el CRM
  botApiKey: process.env.BOT_API_KEY || "",

  // App Secret de Meta para verificar la firma HMAC del webhook de WhatsApp
  // (header X-Hub-Signature-256). Sin esto cualquiera con la URL del webhook
  // puede inyectar mensajes falsos. Ver src/lib/signature.js.
  metaAppSecret: process.env.META_APP_SECRET || "",

  // Fallback single-tenant para WhatsApp (si la org en BD no tiene token propio)
  whatsapp: {
    verifyToken: process.env.VERIFY_TOKEN || "",
    token: process.env.WHATSAPP_TOKEN || "",
    phoneId: process.env.WHATSAPP_PHONE_ID || "",
  },

  // Landing (web/): Sofi y el link para el asesor apuntan aqui en vez del
  // link externo de Wasi/inmo.co (ver src/lib/slug.js).
  landingBaseUrl: process.env.LANDING_BASE_URL || "https://diamondinmobiliaria.com",

  // Recordatorios de cita al asesor (temporizador in-process, ver
  // src/scheduler/reminders.js). Envia la plantilla aprobada de WhatsApp
  // ~1h antes de cada cita. Encendido por defecto; si la plantilla aun no
  // esta aprobada el envio falla en silencio y se reintenta el siguiente tick.
  reminders: {
    enabled: process.env.REMINDERS_ENABLED !== "false",
    templateName: process.env.WHATSAPP_REMINDER_TEMPLATE || "recordatorio_cita",
    templateLang: process.env.WHATSAPP_REMINDER_LANG || "es",
    windowMin: parseInt(process.env.REMINDER_WINDOW_MIN || "60", 10),
    intervalMin: parseInt(process.env.REMINDER_INTERVAL_MIN || "10", 10),
  },

  // Seguimiento automatico de Sofi al cliente que dejo de responder (Capa B
  // Fase 1, ver diamond-os/sofi-conversacion-2.0.md). Un unico toque contextual
  // dentro de la ventana de 24h de WhatsApp (texto libre, sin plantilla).
  // Requiere la migracion 2026-07-23_lead_seguimiento (columna leads.seguimiento);
  // si falta, el worker se auto-desactiva con un warn.
  followups: {
    enabled: process.env.FOLLOWUPS_ENABLED !== "false",
    // 1h de silencio del cliente (Juan, 2026-09-05: "solo quiero que hagas uno
    // solo despues de una hora de no respuesta del cliente"). Antes eran 2h.
    // El toque SIGUE siendo uno solo por lead para siempre — lo garantiza el
    // claim atomico de leads.claimFollowup, no este numero.
    silenceMin: parseInt(process.env.FOLLOWUP_SILENCE_MIN || "60", 10),
    maxSilenceMin: parseInt(process.env.FOLLOWUP_MAX_SILENCE_MIN || "1200", 10), // tope 20h: margen antes del cierre de la ventana de 24h
    intervalMin: parseInt(process.env.FOLLOWUP_INTERVAL_MIN || "15", 10),
    quietStartHour: parseInt(process.env.FOLLOWUP_QUIET_START || "20", 10), // silencio 8pm...
    quietEndHour: parseInt(process.env.FOLLOWUP_QUIET_END || "8", 10), // ...a 8am (hora Colombia)
  },

  // Radar de grupos: lo que se detecta en los grupos gremiales.
  //
  // Entra por tres vias. Dos NO tocan el protocolo de WhatsApp y por lo tanto
  // no son baneables: el export nativo del chat subido al CRM, y el reenvio de
  // un mensaje a Sofi por la Cloud API oficial.
  //
  // La tercera —la escucha en vivo via WAHA— si lo toca, y se reactivo el
  // 2026-08-16 sobre una LINEA DEDICADA de la empresa. Conviene recordar por
  // que: el 2026-07-30 WhatsApp baneo la linea de la asesora que estaba
  // pareada, y ese montaje solo leia. Se sanciona el cliente no oficial, no la
  // conducta, asi que "solo lectura" nunca fue lo que protegia — lo unico que
  // protege es que la linea sea sacrificable.
  groups: {

    // Escucha en vivo. Sin `webhookSecret` el canal NO se monta: es el
    // interruptor de nivel 1, y su ausencia deja el codigo inerte.
    webhookSecret: process.env.GROUPS_WEBHOOK_SECRET || "",
    // Interruptor de nivel 2. Apagarlo frena el webhook Y los endpoints que
    // hablan con WAHA — en julio solo frenaba el primero, y un clic en
    // "Vincular linea" podia re-parear el numero mientras Meta revisaba la
    // cuenta suspendida.
    enabled: process.env.GROUPS_ENABLED === "true",
    // 'sombra' redacta y registra sin publicar; 'auto' publica. Cualquier otro
    // valor apaga la respuesta: un typo no puede encender el envio.
    respuestaModo: process.env.GRUPOS_RESPUESTA_MODO || "sombra",
    // La URL publica del bot: es la que se le configura a WAHA como destino del
    // webhook. Sin ella la sesion se parea y no llega un solo mensaje.
    publicUrl: (process.env.BOT_PUBLIC_URL || "").replace(/\/+$/, ""),

    // Digest diario del radar de grupos.
    //
    // Sale por PLANTILLA porque a las 7am casi nunca hay ventana de 24h
    // abierta con el asesor, y fuera de esa ventana Meta rechaza el texto
    // libre. La plantilla lleva el resumen; el detalle completo se pide
    // respondiendo, que es lo que abre la ventana.
    //
    // Requiere la migracion 2026-08-01_radar_grupos (columna
    // digest_enviado_at); si falta, el worker se auto-desactiva con un warn.
    digest: {
      enabled: process.env.GROUPS_DIGEST_ENABLED !== "false",
      hour: parseInt(process.env.GROUPS_DIGEST_HOUR || "7", 10), // hora Colombia
      intervalMin: parseInt(process.env.GROUPS_DIGEST_INTERVAL_MIN || "15", 10),
      templateName: process.env.WHATSAPP_DIGEST_TEMPLATE || "radar_grupos",
      templateLang: process.env.WHATSAPP_DIGEST_LANG || "es",
      // CSV de telefonos para probar sin tocar a los asesores reales.
      to: (process.env.GROUPS_DIGEST_TO || "").split(",").map((s) => s.trim()).filter(Boolean),
      // A que especialidades se les manda. Solo venta: es el unico mercado con
      // inventario cargado, asi que una demanda de arriendo o de vehiculos no
      // tiene con que cruzarse y el envio de plantilla se paga igual. Vacio =
      // todas, para cuando esos mercados existan.
      especialidades: (process.env.GROUPS_DIGEST_ESPECIALIDADES ?? "venta")
        .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    },

    // Recordatorio si la asesora no responde el aviso de un pedido del radar
    // (Juan, 2026-08-18): la respuesta sirve para calibrar Y renueva la
    // ventana de 24h — sin ella, los avisos siguientes se quedan sin poder
    // salir. Ver src/scheduler/radar-recordatorio.js.
    // El CIERRE DEL DIA reemplaza al recordatorio por pedido (Juan,
    // 2026-09-06). Un solo mensaje, a hora fija, que nombra NUESTRAS
    // propiedades en vez de citar el texto del colega, y que cobra tambien los
    // DM que Sofi mando sola — el 82% que antes nunca se preguntaba.
    // Ver src/scheduler/cierre-dia.js y src/groups/cierre-dia.js.
    cierre: {
      enabled: process.env.RADAR_CIERRE_ENABLED !== "false",
      // Hora de Bogota. 18 = al final de la jornada, cuando ya paso todo lo
      // del dia y la asesora todavia esta con el telefono en la mano.
      hour: parseInt(process.env.RADAR_CIERRE_HOUR || "18", 10),
    },

    // APAGADO desde el 2026-09-06: lo reemplaza `cierre`. El codigo se queda
    // porque el cierre del dia es lo que no esta probado en produccion, y
    // volver atras tiene que costar una variable de entorno, no un revert.
    recordatorio: {
      enabled: process.env.RADAR_RECORDATORIO_ENABLED === "true",
      // 2h: mismo plazo que el seguimiento al cliente (config.followups) —
      // suficiente margen para que la asesora atienda sin que el pedido se
      // enfrie (el colega del grupo puede vender antes a otro que si le escribio).
      silenceMin: parseInt(process.env.RADAR_RECORDATORIO_SILENCE_MIN || "120", 10),
      intervalMin: parseInt(process.env.RADAR_RECORDATORIO_INTERVAL_MIN || "20", 10),
    },

    // Escalado por silencio a Catherine si Natalia (asesor PRINCIPAL del
    // radar) no responde el aviso a tiempo (Juan, 2026-08-26): cubre los dos
    // carriles, venta y compra. Ver src/scheduler/radar-silencio.js.
    silencio: {
      min: parseInt(process.env.RADAR_SILENCIO_MIN || "30", 10),
      intervalMin: parseInt(process.env.RADAR_SILENCIO_INTERVAL_MIN || "5", 10),
    },

    // Mantener abierta la ventana de 24h con la asesora del radar (Juan,
    // 2026-09-04: "y si desde la linea de natalia que la tenemos vinculada
    // para enviar los mensajes le enviamos un mensajes a sofi todos los dias
    // para abrir la ventana??").
    //
    // Meta solo entrega texto libre a quien le escribio al negocio en las
    // ultimas 24h. Si la asesora no le escribe a Sofi, su ventana se cierra y
    // los avisos del radar se pierden — ese dia habia mensajes represados.
    // Nada de lo que hagamos desde nuestro lado la reabre: solo la reabre un
    // mensaje ENTRANTE de ella. Y su linea ES la linea vinculada a WAHA, o sea
    // que ya la controlamos por API. Ver src/scheduler/ventana-asesora.js.
    ventanaAsesora: {
      // APAGADO por defecto, a diferencia del resto de los bloques del radar:
      // es un envio automatico desde una linea no oficial (la misma clase de
      // linea que ya fue baneada el 2026-07-30). Se enciende a conciencia.
      enabled: process.env.VENTANA_ASESORA_ENABLED === "true",
      // 20h y no 24: 4h de margen antes de que Meta cierre la ventana, para que
      // un tick perdido o un WAHA lento no la dejen cerrarse igual.
      horas: parseInt(process.env.VENTANA_ASESORA_HORAS || "20", 10),
      intervalMin: parseInt(process.env.VENTANA_ASESORA_INTERVAL_MIN || "60", 10),
    },

    // Feed en vivo para el admin (Juan, 2026-08-18): cada pedido que Sofi
    // revisa —lo apruebe o lo rechace— le queda en su propia sesion de
    // Sofi-Comando. adminUserId es el auth user id (no el email) del admin
    // que lo recibe; sin configurar, el feed no escribe en ningun lado —
    // ver src/groups/feed-comando.js.
    feedComando: {
      adminUserId: process.env.RADAR_FEED_COMANDO_ADMIN_ID || "",
    },
  },
};

if (!config.anthropicApiKey) {
  console.error("Falta ANTHROPIC_API_KEY en .env");
  process.exit(1);
}

module.exports = config;
