/**
 * Crea la plantilla "seguimiento_cliente" en Meta (Fase 2 del seguimiento de
 * Sofi, diamond-os/sofi-conversacion-2.0.md). Se corre UNA sola vez.
 *
 * Por qué (Juan, 2026-10-17): "necesitamos que se haga seguimiento a todos
 * los mensajes que enviemos". Dentro de las 24 h Sofi hace seguimiento con
 * texto libre (followups.js); pasada la ventana WhatsApp solo deja escribir
 * con una plantilla aprobada, y no había ninguna para clientes.
 *
 * Uso:
 *   railway run --service diamond node scripts/create-seguimiento-cliente-template.mjs
 */
const TOKEN = process.env.WHATSAPP_TOKEN;
const WABA_ID = "1702397800906189"; // WABA de producción (+57 304 4653609)

if (!TOKEN) {
  console.error("Falta WHATSAPP_TOKEN.");
  process.exit(1);
}

const payload = {
  name: "seguimiento_cliente",
  language: "es",
  category: "MARKETING",
  components: [
    {
      type: "BODY",
      text: "Hola, soy Sofi de Diamond Inmobiliaria 😊 Te escribo para saber si sigues buscando {{1}}. Si quieres, te comparto opciones nuevas o te agendo una visita. ¿Te ayudo?",
      example: { body_text: [["apartamento en El Poblado"]] },
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
console.log(`✅ Plantilla "seguimiento_cliente" creada. Estado: ${data.status ?? "PENDING"} (id: ${data.id})`);
