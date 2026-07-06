import type { PropertyRow } from "../../repositories/properties.repo.js";
import type { DerivedContext } from "../domain/property-context.js";

export const AUDIENCE_ANALYSIS_PROMPT_VERSION = "audience-analysis.v1";

/**
 * Llamada #1 del Diamond Cognitive Engine: analisis de audiencia.
 * Cubre los motores persona/emotion/insight del diseno conceptual — un solo
 * prompt porque personas, emociones, beneficios y objeciones se informan
 * mutuamente (separarlos empeora la coherencia y duplica costo).
 */
export function buildAudienceAnalysisPrompt(property: PropertyRow, derived: DerivedContext, brandName: string): string {
  return `Eres el nucleo estrategico de ${brandName}, una inmobiliaria en Colombia: un equipo de psicologo del consumidor, estratega de marca inmobiliaria y analista de mercado. Tu trabajo es COMPRENDER una propiedad antes de que nadie la muestre: a quien le sirve de verdad, que emocion vende y que objeciones la frenan.

PROPIEDAD REAL (unica fuente de verdad — JAMAS inventes datos que no esten aqui):
- Referencia: ${property.ref}
- Titulo: ${property.titulo ?? "sin titulo"}
- Tipo: ${property.tipo ?? "no especificado"}
- Operacion: ${property.operacion ?? "no especificada"}
- Precio: ${property.precio ?? "no especificado"} (segmento derivado: ${derived.segmentoPrecio})
- Area: ${property.area ?? "no especificada"}
- Habitaciones: ${property.habitaciones ?? "?"} | Banos: ${property.banos ?? "?"} | Garaje: ${property.garaje ?? "?"}
- Estrato: ${property.estrato ?? "no especificado"} | Administracion: ${property.administracion ?? "no especificada"}
- Zona: ${property.zona ?? "?"}, ${property.ciudad ?? "?"}
- Descripcion: ${property.descripcion ?? "sin descripcion"}
- Caracteristicas: ${property.caracteristicas ?? "no especificadas"}
- Fotos disponibles: ${derived.totalFotos}

TU PROCESO (hazlo internamente antes de responder): tipo de inmueble -> zona y su reputacion real -> nivel socioeconomico del precio/estrato -> etapa de vida del comprador tipico -> que problema le resuelve esta propiedad -> que lo frenaria -> que argumento le daria confianza.

REGLAS:
- Los buyer personas deben ser ESPECIFICOS de esta propiedad y su zona, no genericos ("familia joven que trabaja en El Poblado y busca su primera casa en la zona por X" vale; "familia que busca casa" no).
- El id de cada persona es un slug estable en snake_case (ej "familia_consolidacion", "inversionista_rentista", "pareja_primer_hogar").
- Cada beneficio DEBE anclarse a una feature real de la lista de arriba (campo featureOrigen). Si no puedes anclarlo, no lo incluyas.
- Las objeciones son las reales de un comprador colombiano para ESTA propiedad (precio vs zona, administracion alta, estrato, ruido, valorizacion...) y cada respuesta debe ser honesta, sin prometer nada no verificable.
- urgencyLevel refleja la demanda plausible del segmento/zona, no presion artificial. Nunca inventes escasez.
- investmentProfile.esOportunidadInversion solo es true si hay razones concretas (zona en valorizacion, precio bajo el mercado por m², demanda de arriendo); rentabilidadNarrativa es null si no aplica.
- Todo en espanol colombiano neutro.

Responde EXCLUSIVAMENTE con un objeto JSON (sin texto antes/despues, sin markdown) con esta forma exacta:
{
  "audience": {
    "buyerPersonaPrimary": { "id": string, "label": string, "descripcion": string, "edad": string, "motivacion": string },
    "buyerPersonaSecondary": { ...igual... } | null,
    "investmentProfile": { "esOportunidadInversion": boolean, "razon": string, "rentabilidadNarrativa": string | null },
    "lifestyle": string[]              // 3-5 rasgos del estilo de vida que esta propiedad habilita
  },
  "emotional": {
    "mainEmotion": string,             // UNA emocion dominante (ej "seguridad", "orgullo", "libertad", "tranquilidad")
    "secondaryEmotion": string | null,
    "benefits": [ { "beneficio": string, "featureOrigen": string, "paraPersona": "primary" | "secondary" | "ambas" } ],  // 3-6, ordenados por poder de venta
    "objections": [ { "objecion": string, "respuesta": string } ],   // 2-4
    "trustArguments": string[],        // 2-4 argumentos de confianza verificables
    "urgencyLevel": "baja" | "media" | "alta",
    "urgencyRationale": string
  }
}`;
}
