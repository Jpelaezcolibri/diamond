/**
 * Crea la plantilla "retomar_cliente" en el WhatsApp Manager de Meta vía
 * Graph API. Se corre UNA sola vez.
 *
 * Por qué (Juan, 2026-10-17): del 3 al 15-oct Sofi recibió mensajes de
 * clientes y no contestó ninguno (sin saldo en Anthropic). Pasadas 24 h,
 * WhatsApp solo deja escribirles con una plantilla aprobada, y no había
 * ninguna para clientes. Con esta, Sofi retoma la conversación y, cuando el
 * cliente responde, se abre la ventana y sigue como siempre.
 *
 * Uso:
 *   railway run --service diamond node scripts/create-retomar-cliente-template.mjs
 *
 * Queda en PENDING hasta que Meta la revise.
 */
const TOKEN = process.env.WHATSAPP_TOKEN;
// WABA de PRODUCCIÓN de Diamond (número +57 304 4653609).
const WABA_ID = "1702397800906189";

if (!TOKEN) {
  console.error("Falta WHATSAPP_TOKEN.");
  process.exit(1);
}

const payload = {
  name: "retomar_cliente",
  language: "es",
  category: "MARKETING",
  components: [
    {
      type: "BODY",
      text: "Hola, te escribe Sofi de Diamond Inmobiliaria. Nos escribiste por {{1}} y no alcanzamos a responderte a tiempo, ¡qué pena contigo! ¿Sigues interesado? Respóndeme y te ayudo ya mismo.",
      example: { body_text: [["la propiedad ref 10414675"]] },
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
console.log(`✅ Plantilla "retomar_cliente" creada. Estado: ${data.status ?? "PENDING"} (id: ${data.id})`);
