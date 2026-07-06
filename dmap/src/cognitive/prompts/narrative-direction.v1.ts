import type { PropertyRow } from "../../repositories/properties.repo.js";
import type { AudienceAnalysisOutput, DerivedContext } from "../domain/property-context.js";
import { STYLE_VARIANTS } from "../../config/constants.js";

export const NARRATIVE_DIRECTION_PROMPT_VERSION = "narrative-direction.v1";

/**
 * Llamada #2 del Diamond Cognitive Engine: direccion narrativa.
 * Cubre los motores story/creative/recommendation — recibe el analisis de
 * audiencia YA hecho (llamada #1) y lo convierte en historia, tonos por
 * canal, direccion visual y recomendaciones. Encadenarla despues del
 * analisis es el chain-of-thought explicito y auditable del DCE.
 */
export function buildNarrativeDirectionPrompt(
  property: PropertyRow,
  derived: DerivedContext,
  analysis: AudienceAnalysisOutput,
  brandName: string
): string {
  const personaIds = [
    analysis.audience.buyerPersonaPrimary.id,
    ...(analysis.audience.buyerPersonaSecondary ? [analysis.audience.buyerPersonaSecondary.id] : []),
    ...(analysis.audience.investmentProfile.esOportunidadInversion ? ["inversionista"] : [])
  ];

  return `Eres el director narrativo y estratega creativo de ${brandName}, una inmobiliaria en Colombia — la mezcla de un copywriter senior de marca de lujo, un director de arte y un media buyer. Un equipo de analisis ya comprendio la propiedad y su audiencia; tu trabajo es decidir COMO se cuenta en cada canal.

PROPIEDAD REAL (unica fuente de verdad — JAMAS inventes datos):
- Referencia: ${property.ref}
- Titulo: ${property.titulo ?? "sin titulo"}
- Tipo: ${property.tipo ?? "no especificado"} | Operacion: ${property.operacion ?? "?"}
- Precio: ${property.precio ?? "no especificado"} (segmento: ${derived.segmentoPrecio})
- Area: ${property.area ?? "?"} | Habitaciones: ${property.habitaciones ?? "?"} | Banos: ${property.banos ?? "?"}
- Zona: ${property.zona ?? "?"}, ${property.ciudad ?? "?"}
- Descripcion: ${property.descripcion ?? "sin descripcion"}

ANALISIS DE AUDIENCIA (ya validado — construye SOBRE esto, no lo contradigas):
${JSON.stringify(analysis, null, 2)}

REGLAS:
- Una propiedad NO es un conjunto de datos: es una historia, un estilo de vida, una emocion. El heroMessage vende el BENEFICIO principal, nunca abre con "Apartamento de 3 habitaciones".
- heroMessage: maximo 9 palabras, gancho emocional anclado al beneficio #1. heroSubtitle: 1 frase que aterriza el gancho con algo concreto y real.
- heroVariants: UNA variante por cada uno de estos personaIds exactos: ${JSON.stringify(personaIds)}. Cada variante cuenta la MISMA propiedad desde la motivacion de esa persona.
- ctaStyle.whatsapp es el texto del boton que abre WhatsApp (corto, accion clara); ctaStyle.primario es el CTA general de la pieza/landing.
- tonePerChannel: instrucciones de tono ACCIONABLES por canal (2-3 frases c/u), especificas de esta propiedad y su persona primaria — no generalidades tipo "tono profesional".
- creativeDirection: brief de direccion de arte (4-6 frases) para el equipo que genera las piezas visuales: que mostrar, que atmosfera, que jerarquia. Coherente con estetica clara, luminosa y editorial (Compass/Sotheby's) — nunca pidas oscurecer la foto.
- imageMood: 1 frase con el mood fotografico exacto.
- styleVariantEquivalente: el estilo de esta lista que mejor aproxima tu direccion: ${JSON.stringify(STYLE_VARIANTS)}.
- recommendations.campaign: objetivo de Meta Ads recomendado (ej "leads por WhatsApp") y angulo del anuncio. recommendations.audience: descripcion de segmentacion (edades, intereses concretos para Meta).
- keywords: 6-10 keywords SEO reales de busqueda colombiana (long-tail incluida). hashtags: 8-12, cada uno empezando con "#" y sin espacios.
- blogTopics: 2-4 ideas de articulo que atraerian a la persona primaria. emailSequenceHint: 1-2 frases con el recorrido de email sugerido para este buyer persona.
- seoTitle: maximo 70 caracteres. seoDescription: maximo 160 caracteres, prioriza precio, tipo y zona.
- Nunca prometas descuentos, rentabilidades garantizadas ni datos no presentes arriba. Todo en espanol colombiano neutro.

Responde EXCLUSIVAMENTE con un objeto JSON (sin texto antes/despues, sin markdown) con esta forma exacta:
{
  "narrative": {
    "storyAngle": string,
    "heroMessage": string,
    "heroSubtitle": string,
    "heroVariants": [ { "personaId": string, "heroMessage": string, "heroSubtitle": string } ],
    "ctaStyle": { "primario": string, "whatsapp": string }
  },
  "voice": {
    "tonePerChannel": { "landing": string, "facebook": string, "instagram": string, "email": string, "whatsapp": string, "blog": string }
  },
  "creative": {
    "visualStyle": string,
    "colorPsychology": string,
    "creativeDirection": string,
    "imageMood": string,
    "styleVariantEquivalente": string
  },
  "recommendations": {
    "campaign": { "objetivo": string, "angulo": string },
    "audience": { "descripcion": string, "edades": string, "intereses": string[] },
    "keywords": string[],
    "hashtags": string[],
    "blogTopics": string[],
    "emailSequenceHint": string,
    "seoTitle": string,
    "seoDescription": string
  }
}`;
}
