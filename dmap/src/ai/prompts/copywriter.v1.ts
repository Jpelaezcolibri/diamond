import type { StyleVariant } from "../../config/constants.js";

export const COPYWRITER_PROMPT_VERSION = "copywriter.v1";

export interface CopywriterPropertyInput {
  ref: string;
  titulo: string | null;
  operacion: string | null;
  precio: string | null;
  area: string | null;
  habitaciones: number | null;
  banos: number | null;
  zona: string | null;
  ciudad: string | null;
  descripcion: string | null;
  caracteristicas?: string | null;
}

export interface BrandVoiceInput {
  name: string;
  primaryColor?: string;
}

const STYLE_GUIDANCE: Record<StyleVariant, string> = {
  lujo: "Enfasis en exclusividad, materiales, acabados y estatus. Tono aspiracional, sin exagerar.",
  familiar: "Enfasis en espacios para la familia, seguridad del sector, cercania a colegios y parques.",
  inversionista: "Enfasis en valorizacion, rentabilidad potencial, ubicacion estrategica y demanda de la zona.",
  premium: "Enfasis en calidad de vida, diseno y confort superior sin sonar elitista.",
  corporativo: "Tono profesional y directo, datos duros primero (precio, area, ubicacion), poco adorno."
};

/**
 * Construye el prompt de copywriting — ver dmap/ARCHITECTURE.md #6.
 * La instruccion explicita de variar estructura/gancho/CTA es lo que evita
 * plantillas repetitivas entre corridas (requisito del usuario).
 *
 * `cognitiveBrief` (opcional) es el brief del Diamond Cognitive Engine
 * (cognitive/application/briefs.ts): cuando existe, el copy se escribe para
 * el buyer persona/emocion inferidos en vez del estilo generico. Sin el, el
 * prompt es identico al flujo legacy.
 */
export function buildCopyPrompt(
  property: CopywriterPropertyInput,
  styleVariant: StyleVariant,
  brand: BrandVoiceInput,
  cognitiveBrief?: string
): string {
  return `Eres un copywriter inmobiliario experto para ${brand.name}, una inmobiliaria en Colombia.

Genera contenido de marketing para esta propiedad, en estilo "${styleVariant}": ${STYLE_GUIDANCE[styleVariant]}
${cognitiveBrief ? `\n${cognitiveBrief}\nCuando el contexto estrategico y el estilo generico choquen, manda el contexto estrategico.\n` : ""}
Propiedad:
- Referencia: ${property.ref}
- Titulo actual: ${property.titulo ?? "sin titulo"}
- Operacion: ${property.operacion ?? "no especificada"}
- Precio: ${property.precio ?? "no especificado"}
- Area: ${property.area ?? "no especificada"}
- Habitaciones: ${property.habitaciones ?? "no especificado"}
- Banos: ${property.banos ?? "no especificado"}
- Zona: ${property.zona ?? "no especificada"}, ${property.ciudad ?? ""}
- Descripcion actual: ${property.descripcion ?? "sin descripcion"}
- Caracteristicas: ${property.caracteristicas ?? "no especificadas"}

Reglas obligatorias:
- Nunca inventes precio, area, habitaciones ni disponibilidad: usa solo los datos de arriba.
- Nunca prometas descuentos ni financiacion no mencionada.
- Varia la estructura, el gancho inicial y el CTA respecto a otras publicaciones — evita plantillas repetitivas.
- copy_facebook: 2-4 parrafos cortos, tono conversacional.
- copy_instagram: mas corto, con emojis moderados, terminando en una pregunta o CTA.
- hashtags: 8-12, mezcla de genericos inmobiliarios y especificos de la zona/ciudad. Cada uno DEBE empezar con "#" y no llevar espacios (ej: "#ApartamentosMedellin", "#VentaDeApartamentos").
- alt_texts: describe la foto de portada en una frase util para accesibilidad (sin inventar detalles no visibles).
- meta_title: maximo 70 caracteres EXACTOS (cuenta caracteres, no palabras) — es la etiqueta SEO <title>, se corta en buscadores si es mas largo.
- meta_description: maximo 160 caracteres EXACTOS (cuenta caracteres, no palabras) — es la meta description SEO, se corta en buscadores si es mas larga. Prioriza precio, tipo de propiedad y zona; no repitas el titulo completo.

Responde EXCLUSIVAMENTE con un objeto JSON (sin texto antes o despues, sin markdown) con esta forma exacta:
{
  "copy_facebook": string,
  "copy_instagram": string,
  "titulo_comercial": string,
  "descripcion_comercial": string,
  "meta_title": string,
  "meta_description": string,
  "hashtags": string[],
  "cta": string,
  "alt_text_cover": string
}`;
}
