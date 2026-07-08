export const IMAGE_BRIEF_FIT_PROMPT_VERSION = "image-brief-fit.v1";

/**
 * Prompt para evaluar que tan bien cada foto REAL de la propiedad sirve la
 * direccion creativa del Diamond Cognitive Engine — ver dmap/ARCHITECTURE.md
 * #6. Se corre SOLO sobre las candidatas ya filtradas por calidad
 * (image-selector.v1), nunca sobre el lote completo: el objetivo es
 * reordenar entre las mejores tecnicamente, no reemplazar ese filtro.
 *
 * Reemplazado por image-brief-fit.v2.ts (mismo rigor que el Critico Creativo)
 * — se mantiene este archivo por historial/auditoria de prompt_version.
 */
export function buildImageBriefFitPrompt(brief: string, imageCount: number): string {
  return `Eres el Director de Arte de Diamond Inmobiliaria eligiendo QUE FOTO REAL de la propiedad va de portada, antes de que el equipo de diseno la use. Tu unico criterio es si la foto sirve la direccion estrategica de abajo — la calidad tecnica (nitidez, brillo, encuadre) ya se evaluo en un paso anterior, no la repitas.

DIRECCION ESTRATEGICA que la foto elegida debe servir:
${brief}

Analiza estas ${imageCount} fotos reales de la propiedad (indice 0 a ${imageCount - 1}, mismo orden en que se muestran) y evalua para cada una que tan bien esa foto especifica sirve la direccion de arriba: que muestra, que contexto/elementos incluye o le faltan, si el tipo de espacio/composicion coincide con lo que la direccion pide.

Para cada foto:
- brief_fit_score: 0-100 (100 = esta foto especifica es exactamente lo que la direccion pide; 0 = la contradice o es irrelevante para ella).
- reason: una frase corta y concreta (que muestra la foto respecto a lo que pide la direccion).

Responde EXCLUSIVAMENTE con un array JSON (sin texto antes o despues, sin markdown), un objeto por foto en el mismo orden:
[
  { "index": 0, "brief_fit_score": 0, "reason": "..." }
]`;
}
