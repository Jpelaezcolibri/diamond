/**
 * Crea la plantilla "vigencia_propiedad" (spec 2026-10-19-sofi-publica-
 * propiedad-asesor §6). A los 25 dias de publicada una propiedad de asesor,
 * la ventana de 24 h casi seguro esta cerrada: sin plantilla, la pregunta no
 * sale. Se corre UNA vez:
 *   railway run --service diamond node scripts/create-vigencia-propiedad-template.mjs
 * Queda en PENDING hasta que Meta la revise.
 */
const TOKEN = process.env.WHATSAPP_TOKEN;
const WABA_ID = "1702397800906189"; // WABA de produccion (+57 304 4653609)
if (!TOKEN) {
  console.error("Falta WHATSAPP_TOKEN.");
  process.exit(1);
}
const payload = {
  name: "vigencia_propiedad",
  language: "es",
  category: "UTILITY",
  components: [
    {
      type: "BODY",
      text: "Hola, soy Sofi de Diamond Inmobiliaria. Tu propiedad {{1}} ({{2}}) vence en 5 días en nuestro inventario. ¿Sigue disponible?",
      example: { body_text: [["D1001", "Apartamento amoblado en arriendo en Laureles"]] },
    },
    { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Sigue disponible" }, { type: "QUICK_REPLY", text: "Ya no está" }] },
  ],
};
const res = await fetch(`https://graph.facebook.com/v21.0/${WABA_ID}/message_templates`, {
  method: "POST",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
console.log(res.status, await res.text());
