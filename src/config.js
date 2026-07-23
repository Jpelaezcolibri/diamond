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

  // API interna para el CRM
  botApiKey: process.env.BOT_API_KEY || "",

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
};

if (!config.anthropicApiKey) {
  console.error("Falta ANTHROPIC_API_KEY en .env");
  process.exit(1);
}

module.exports = config;
