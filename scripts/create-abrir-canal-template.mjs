/**
 * Crea la plantilla "abrir_canal_asesora" (Juan, 2026-11-15): le llega cada
 * mañana a la asesora que tiene la ventana de 24 h cerrada; al tocar
 * "Estoy disponible" la ventana se abre y le llegan las visitas y los casos
 * de colegas. Se corre UNA vez con el token de producción:
 *
 *   railway run --service diamond node scripts/create-abrir-canal-template.mjs
 *
 * Queda PENDING hasta que Meta la revise. Al aprobarse, poner en Railway
 * CANAL_ASESORAS_PLANTILLA=abrir_canal_asesora (scheduler/abrir-canal-asesoras.js).
 */
import "dotenv/config";

const TOKEN = process.env.WHATSAPP_TOKEN;
// WABA de PRODUCCIÓN de Diamond (ver create-recordatorio-template.mjs).
const WABA_ID = "1702397800906189";
if (!TOKEN) {
  console.error("Falta WHATSAPP_TOKEN.");
  process.exit(1);
}

const payload = {
  name: "abrir_canal_asesora",
  language: "es",
  category: "UTILITY",
  components: [
    {
      type: "BODY",
      text: "Hola {{1}}, hoy te pueden llegar visitas por confirmar y casos de colegas. Toca Estoy disponible para recibirlos por este chat durante el día.",
      example: { body_text: [["Claudia"]] },
    },
    { type: "FOOTER", text: "Diamond Inmobiliaria" },
    { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Estoy disponible" }] },
  ],
};

const res = await fetch(`https://graph.facebook.com/v21.0/${WABA_ID}/message_templates`, {
  method: "POST",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
const data = await res.json();
if (!res.ok) {
  console.error(`❌ Meta rechazó "${payload.name}":`, JSON.stringify(data.error || data));
  process.exit(1);
}
console.log(`✅ "${payload.name}" creada. Estado: ${data.status ?? "PENDING"} (id: ${data.id})`);
