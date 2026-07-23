/**
 * Crea la plantilla "recordatorio_cita" en el WhatsApp Manager de Meta vía
 * Graph API. Se corre UNA sola vez, localmente. Usa el WHATSAPP_TOKEN que ya
 * está en el .env de la raíz (token permanente del usuario del sistema, con
 * permiso whatsapp_business_management — verificado).
 *
 * Uso:
 *   node scripts/create-recordatorio-template.mjs
 *
 * Queda en estado PENDING hasta que Meta la revise (categoría Utility suele
 * aprobar en minutos). Verás el estado en business.facebook.com → WhatsApp
 * Manager → Plantillas.
 */
import "dotenv/config";

const TOKEN = process.env.WHATSAPP_TOKEN;
// WABA de PRODUCCIÓN de Diamond (dueño del número +57 304 4653609 / phone id
// 1112994355241344, que es el que el bot usa desde Supabase). NO es el WABA
// de prueba.
const WABA_ID = "1702397800906189";

if (!TOKEN) {
  console.error("Falta WHATSAPP_TOKEN en el .env de la raíz.");
  process.exit(1);
}

const payload = {
  name: "recordatorio_cita",
  language: "es",
  category: "UTILITY",
  components: [
    {
      type: "BODY",
      text: "Hola {{1}}, te recordamos tu {{2}} con {{3}} hoy a las {{4}}. Revisa los detalles en el CRM.",
      example: { body_text: [["Claudia", "visita", "Marta Gomez", "3:00 p.m."]] },
    },
    { type: "FOOTER", text: "Diamond Inmobiliaria" },
  ],
};

const res = await fetch(`https://graph.facebook.com/v21.0/${WABA_ID}/message_templates`, {
  method: "POST",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
const data = await res.json();

if (!res.ok) {
  console.error("❌ Meta rechazó la creación:");
  console.error(JSON.stringify(data, null, 2));
  process.exit(1);
}
console.log(`✅ Plantilla "recordatorio_cita" creada. Estado: ${data.status ?? "PENDING"} (id: ${data.id})`);
console.log("Revisa el estado en business.facebook.com → WhatsApp Manager → Plantillas.");
