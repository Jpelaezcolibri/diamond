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
};

if (!config.anthropicApiKey) {
  console.error("Falta ANTHROPIC_API_KEY en .env");
  process.exit(1);
}

module.exports = config;
