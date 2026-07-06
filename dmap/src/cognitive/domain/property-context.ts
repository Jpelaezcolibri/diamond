import { z } from "zod";
import { normalizeHashtags } from "../../lib/hashtags.js";
import { STYLE_VARIANTS } from "../../config/constants.js";

/**
 * Diamond Cognitive Engine — Property Context (schema_version 1).
 *
 * El contexto estrategico que DCE infiere de una propiedad: a quien le
 * sirve y como se cuenta. Es el contrato central del ecosistema — los
 * consumidores (creativos DMAP hoy; landing, Sofi, SEO, email en fases
 * posteriores) leen este JSON de la tabla property_contexts, nunca los
 * datos crudos ni llaman a Claude por su cuenta.
 *
 * Regla de diseno: si un campo se puede derivar con un `if`, va en
 * `derived` (derive.rules.ts, sin Claude); todo lo demas sale de dos
 * llamadas encadenadas (audience-analysis -> narrative-direction).
 */

export const PROPERTY_CONTEXT_SCHEMA_VERSION = 1;

// ── Grupo audience + emotional (llamada Claude #1: analisis de audiencia) ──

export const buyerPersonaSchema = z.object({
  /** Slug estable (ej "familia_consolidacion") — clave de heroVariants y del Match futuro. */
  id: z.string().min(1),
  label: z.string().min(1),
  descripcion: z.string().min(1),
  edad: z.string().min(1),
  motivacion: z.string().min(1)
});

export const audienceSchema = z.object({
  buyerPersonaPrimary: buyerPersonaSchema,
  buyerPersonaSecondary: buyerPersonaSchema.nullable(),
  investmentProfile: z.object({
    esOportunidadInversion: z.boolean(),
    razon: z.string().min(1),
    rentabilidadNarrativa: z.string().nullable()
  }),
  lifestyle: z.array(z.string()).min(1)
});

export const emotionalSchema = z.object({
  mainEmotion: z.string().min(1),
  secondaryEmotion: z.string().nullable(),
  benefits: z
    .array(
      z.object({
        beneficio: z.string().min(1),
        /** Feature real de la propiedad que lo sustenta — ancla anti-invento. */
        featureOrigen: z.string().min(1),
        paraPersona: z.enum(["primary", "secondary", "ambas"])
      })
    )
    .min(1),
  objections: z.array(z.object({ objecion: z.string().min(1), respuesta: z.string().min(1) })),
  trustArguments: z.array(z.string()),
  urgencyLevel: z.enum(["baja", "media", "alta"]),
  urgencyRationale: z.string().min(1)
});

// ── Grupos narrative/voice/creative/recommendations (llamada Claude #2) ──

export const heroVariantSchema = z.object({
  /** id de la persona a la que apunta esta variante (o "investor"). */
  personaId: z.string().min(1),
  heroMessage: z.string().min(1),
  heroSubtitle: z.string().min(1)
});

export const narrativeSchema = z.object({
  storyAngle: z.string().min(1),
  heroMessage: z.string().min(1),
  heroSubtitle: z.string().min(1),
  /** Variantes por persona — habilitan el Match Context (Fase 4) sin re-inferir. */
  heroVariants: z.array(heroVariantSchema),
  ctaStyle: z.object({ primario: z.string().min(1), whatsapp: z.string().min(1) })
});

export const voiceSchema = z.object({
  tonePerChannel: z.object({
    landing: z.string().min(1),
    facebook: z.string().min(1),
    instagram: z.string().min(1),
    email: z.string().min(1),
    whatsapp: z.string().min(1),
    blog: z.string().min(1)
  })
});

export const creativeSchema = z.object({
  visualStyle: z.string().min(1),
  colorPsychology: z.string().min(1),
  /** Brief de direccion de arte que consume el Director Creativo (creative-director). */
  creativeDirection: z.string().min(1),
  imageMood: z.string().min(1),
  /** Puente de compatibilidad con la UI actual del Content Studio (STYLE_VARIANTS). */
  styleVariantEquivalente: z.enum(STYLE_VARIANTS)
});

const SEO_LIMITS = { seoTitle: 70, seoDescription: 160 } as const;

export const recommendationsSchema = z.object({
  campaign: z.object({ objetivo: z.string().min(1), angulo: z.string().min(1) }),
  audience: z.object({
    descripcion: z.string().min(1),
    edades: z.string().min(1),
    intereses: z.array(z.string()).min(1)
  }),
  keywords: z.array(z.string()).min(1),
  hashtags: z.array(z.string()).min(1).transform(normalizeHashtags),
  blogTopics: z.array(z.string()),
  emailSequenceHint: z.string().min(1),
  // Mismo recorte de seguridad que el copywriter: los LLM no cuentan
  // caracteres de forma confiable (bug real 2026-07-06 en meta_description).
  seoTitle: z
    .string()
    .min(1)
    .transform((v) => v.slice(0, SEO_LIMITS.seoTitle).trim()),
  seoDescription: z
    .string()
    .min(1)
    .transform((v) => v.slice(0, SEO_LIMITS.seoDescription).trim())
});

// ── Grupo derived (100% determinista — derive.rules.ts, sin Claude) ──

export const derivedSchema = z.object({
  segmentoPrecio: z.enum(["economico", "medio", "medio-alto", "alto", "lujo", "desconocido"]),
  categoriaOperacion: z.enum(["venta", "arriendo", "desconocida"]),
  precioNumerico: z.number().nullable(),
  totalFotos: z.number().int().min(0),
  totalCaracteristicas: z.number().int().min(0)
});

// ── Contexto completo ──

export const propertyContextSchema = z.object({
  audience: audienceSchema,
  emotional: emotionalSchema,
  narrative: narrativeSchema,
  voice: voiceSchema,
  creative: creativeSchema,
  recommendations: recommendationsSchema,
  derived: derivedSchema
});

export type BuyerPersona = z.infer<typeof buyerPersonaSchema>;
export type AudienceContext = z.infer<typeof audienceSchema>;
export type EmotionalContext = z.infer<typeof emotionalSchema>;
export type NarrativeContext = z.infer<typeof narrativeSchema>;
export type VoiceContext = z.infer<typeof voiceSchema>;
export type CreativeContext = z.infer<typeof creativeSchema>;
export type RecommendationsContext = z.infer<typeof recommendationsSchema>;
export type DerivedContext = z.infer<typeof derivedSchema>;
export type PropertyContext = z.infer<typeof propertyContextSchema>;

/** Salida de la llamada #1 (analisis de audiencia). */
export const audienceAnalysisOutputSchema = z.object({
  audience: audienceSchema,
  emotional: emotionalSchema
});
export type AudienceAnalysisOutput = z.infer<typeof audienceAnalysisOutputSchema>;

/** Salida de la llamada #2 (direccion narrativa). */
export const narrativeDirectionOutputSchema = z.object({
  narrative: narrativeSchema,
  voice: voiceSchema,
  creative: creativeSchema,
  recommendations: recommendationsSchema
});
export type NarrativeDirectionOutput = z.infer<typeof narrativeDirectionOutputSchema>;
