import type { PropertyContext } from "../domain/property-context.js";

/**
 * Traduce el Property Context (JSON completo) a briefs compactos de texto
 * para inyectar en los prompts de los agentes existentes (copywriter,
 * director creativo, critico). Mantenerlos cortos es deliberado: el contexto
 * completo son ~2-3K tokens y cada agente solo necesita su tajada.
 */

export function copywriterBriefFromContext(ctx: PropertyContext): string {
  const persona = ctx.audience.buyerPersonaPrimary;
  const benefits = ctx.emotional.benefits
    .slice(0, 4)
    .map((b) => `- ${b.beneficio} (sustentado en: ${b.featureOrigen})`)
    .join("\n");
  const objections = ctx.emotional.objections
    .slice(0, 3)
    .map((o) => `- "${o.objecion}" -> ${o.respuesta}`)
    .join("\n");

  return `CONTEXTO ESTRATEGICO (Diamond Cognitive Engine — ya analizo esta propiedad; escribe PARA esta audiencia, no para un publico generico):
- Buyer persona: ${persona.label} (${persona.edad}). Motivacion: ${persona.motivacion}
- Emocion dominante a evocar: ${ctx.emotional.mainEmotion}${ctx.emotional.secondaryEmotion ? ` (secundaria: ${ctx.emotional.secondaryEmotion})` : ""}
- Angulo de la historia: ${ctx.narrative.storyAngle}
- Beneficios a destacar (en este orden de fuerza):
${benefits}
- Objeciones reales a desactivar sutilmente (sin nombrarlas como objecion):
${objections}
- Tono para Facebook: ${ctx.voice.tonePerChannel.facebook}
- Tono para Instagram: ${ctx.voice.tonePerChannel.instagram}
- CTA sugerido: ${ctx.narrative.ctaStyle.primario}
- Urgencia real del mercado: ${ctx.emotional.urgencyLevel} (${ctx.emotional.urgencyRationale}) — nunca inventes escasez por encima de esto.`;
}

/** Mismo brief para director Y critico: el critico evalua contra la direccion que recibio el director. */
export function directorBriefFromContext(ctx: PropertyContext): string {
  const persona = ctx.audience.buyerPersonaPrimary;
  return `DIRECCION COGNITIVA (Diamond Cognitive Engine — brief estrategico ya validado para esta propiedad; tu prompt maestro debe ser coherente con el):
- Audiencia: ${persona.label}. Emocion a evocar: ${ctx.emotional.mainEmotion}.
- Direccion creativa: ${ctx.creative.creativeDirection}
- Estilo visual: ${ctx.creative.visualStyle}
- Psicologia de color: ${ctx.creative.colorPsychology}
- Mood fotografico: ${ctx.creative.imageMood}
- Angulo narrativo: ${ctx.narrative.storyAngle}`;
}
