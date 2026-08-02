require("dotenv").config({ override: true });

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
    silenceMin: parseInt(process.env.FOLLOWUP_SILENCE_MIN || "120", 10), // 2h de silencio del cliente
    maxSilenceMin: parseInt(process.env.FOLLOWUP_MAX_SILENCE_MIN || "1200", 10), // tope 20h: margen antes del cierre de la ventana de 24h
    intervalMin: parseInt(process.env.FOLLOWUP_INTERVAL_MIN || "15", 10),
    quietStartHour: parseInt(process.env.FOLLOWUP_QUIET_START || "20", 10), // silencio 8pm...
    quietEndHour: parseInt(process.env.FOLLOWUP_QUIET_END || "8", 10), // ...a 8am (hora Colombia)
  },

  // Radar de grupos: lo que se detecta en los grupos gremiales.
  //
  // La captura entra por dos vias que NO tocan el protocolo de WhatsApp y por
  // lo tanto no son baneables: el export nativo del chat subido al CRM, y el
  // reenvio de un mensaje a Sofi por la Cloud API oficial. La escucha en vivo
  // via WAHA se retiro el 2026-07-30, cuando WhatsApp baneo la linea de la
  // asesora que estaba pareada — sanciona el cliente no oficial, no la
  // conducta, asi que "solo lectura" no protegia de nada.
  groups: {

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
    },
  },
};

if (!config.anthropicApiKey) {
  console.error("Falta ANTHROPIC_API_KEY en .env");
  process.exit(1);
}

module.exports = config;
