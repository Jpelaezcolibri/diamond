/**
 * Crea las plantillas "pregunta_asesor" y "respuesta_lista" (spec
 * 2026-10-25-sofi-pregunta-al-asesor §7) en el WhatsApp Manager de Meta.
 * Se corre UNA sola vez, con el token de producción:
 *
 *   railway run --service diamond node scripts/create-preguntas-templates.mjs
 *
 * Quedan PENDING hasta que Meta las revise. Al aprobarse, poner en Railway
 * SOFI_PREGUNTA_ASESOR_PLANTILLA=pregunta_asesor y
 * SOFI_RESPUESTA_LISTA_PLANTILLA=respuesta_lista. Sin ellas todo sigue por la
 * campana del CRM y dentro de las ventanas abiertas.
 */
import "dotenv/config";

const TOKEN = process.env.WHATSAPP_TOKEN;
// WABA de PRODUCCIÓN de Diamond (ver create-recordatorio-template.mjs).
const WABA_ID = "1702397800906189";

if (!TOKEN) {
  console.error("Falta WHATSAPP_TOKEN.");
  process.exit(1);
}

const PLANTILLAS = [
  {
    name: "pregunta_asesor",
    language: "es",
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: "Tienes una pregunta de un colega sobre la Ref {{1}}: {{2}}. Respóndeme este mensaje con el dato y se lo paso.",
        example: { body_text: [["10013037", "¿Cuál es el precio final?"]] },
      },
    ],
  },
  {
    name: "respuesta_lista",
    language: "es",
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: "Hola {{1}}, ya tengo la respuesta sobre la Ref {{2}}. ¿Te la paso?",
        example: { body_text: [["Laura", "10013037"]] },
      },
    ],
  },
];

for (const payload of PLANTILLAS) {
  const res = await fetch(`https://graph.facebook.com/v21.0/${WABA_ID}/message_templates`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`❌ Meta rechazó "${payload.name}":`, JSON.stringify(data.error || data));
    continue;
  }
  console.log(`✅ "${payload.name}" creada. Estado: ${data.status ?? "PENDING"} (id: ${data.id})`);
}
