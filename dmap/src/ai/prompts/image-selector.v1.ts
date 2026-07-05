export const IMAGE_SELECTOR_PROMPT_VERSION = "image-selector.v1";

/**
 * Prompt para el analisis en batch de fotos de una propiedad — ver
 * dmap/ARCHITECTURE.md #6. El ranking final NO lo decide el modelo: el
 * modelo solo describe cada foto, y el codigo (rankImages en
 * image-selector.ts) aplica la prioridad determinista.
 */
export function buildImageAnalysisPrompt(imageCount: number): string {
  return `Analiza estas ${imageCount} fotos de una propiedad inmobiliaria, en el mismo orden en que se te muestran (indice 0 a ${imageCount - 1}).

Para cada foto clasifica:
- room_type: una de "fachada", "sala", "cocina", "balcon", "vista", "habitacion_principal", "bano", "otro".
- brightness_score: 0-100 (100 = muy bien iluminada).
- quality_score: 0-100 (nitidez, encuadre, composicion general).
- is_dark: true si esta demasiado oscura para usarse en una publicacion.
- duplicate_of_index: el indice (0-based) de otra foto de esta misma lista si es una toma casi identica a otra ya vista, o null si es unica.

Responde EXCLUSIVAMENTE con un array JSON (sin texto antes o despues, sin markdown), con un objeto por foto en el mismo orden:
[
  { "index": 0, "room_type": "...", "brightness_score": 0, "quality_score": 0, "is_dark": false, "duplicate_of_index": null }
]`;
}
