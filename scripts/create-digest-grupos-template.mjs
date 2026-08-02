/**
 * Crea la plantilla "radar_grupos" en el WhatsApp Manager de Meta vía Graph
 * API. Se corre UNA sola vez, localmente. Mismo patrón que
 * create-recordatorio-template.mjs.
 *
 * Uso:
 *   node scripts/create-digest-grupos-template.mjs
 *
 * POR QUÉ HACE FALTA UNA PLANTILLA. El digest sale a las 7am y a esa hora casi
 * nunca hay una ventana de 24h abierta con el asesor. Fuera de esa ventana
 * Meta rechaza el texto libre — la plantilla es la única vía.
 *
 * POR QUÉ ES UN RESUMEN Y NO EL DETALLE. Los parámetros de plantilla de Meta
 * no admiten saltos de línea, así que quince señales no caben. El asesor
 * responde y ahí sí, con la ventana abierta, Sofi le manda todo.
 *
 * Queda en PENDING hasta que Meta la revise (Utility suele aprobar en
 * minutos). El worker tolera que todavía no esté aprobada: si el envío falla,
 * devuelve las señales a la fila para el día siguiente.
 */
import "dotenv/config";

const TOKEN = process.env.WHATSAPP_TOKEN;
// WABA de PRODUCCIÓN de Diamond — el mismo de recordatorio_cita.
const WABA_ID = "1702397800906189";

if (!TOKEN) {
  console.error("Falta WHATSAPP_TOKEN en el .env de la raíz.");
  process.exit(1);
}

const payload = {
  name: "radar_grupos",
  language: "es",
  category: "UTILITY",
  components: [
    {
      type: "BODY",
      text:
        "Buenos días {{1}}. En los grupos: {{2}} pedidos de colegas que calzan con el inventario " +
        "y {{3}} propiedades nuevas de la red.\n\n{{4}}.\n\nRespóndeme VER y te paso el detalle.",
      example: {
        body_text: [[
          "Natalia",
          "3",
          "7",
          "Marcela Ruiz busca apartamento en Laureles y tenemos ref 9944723",
        ]],
      },
    },
    { type: "FOOTER", text: "Radar de grupos" },
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
console.log(`✅ Plantilla "radar_grupos" creada. Estado: ${data.status ?? "PENDING"} (id: ${data.id})`);
console.log("Revisa el estado en business.facebook.com → WhatsApp Manager → Plantillas.");
