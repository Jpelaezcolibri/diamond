import { z } from "zod";

// ---------------------------------------------------------------------------
// REF · TenantConfig — contrato central del framework.
// Todo lo que ve el visitante (marca, colores, textos, secciones, SEO) sale
// de aqui. Una config invalida rompe el build, nunca produccion.
// ---------------------------------------------------------------------------

const Hex = z.string().regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/, "Color hex invalido");

/** Par de colores light/dark para un mismo token. */
const HexPair = z.object({ light: Hex, dark: Hex });

/**
 * Texto visible al visitante: un string plano (un solo idioma, retrocompatible)
 * o bilingüe { es, en } — el toggle de idioma de la landing resuelve el par en
 * el cliente (ver components/shared/lt.tsx). El copy NO visible (SEO, mensajes
 * de WhatsApp, alt de imagenes) queda como z.string() a proposito: se sirve
 * del servidor antes de conocer el idioma del visitante.
 */
const LocalizedString = z.union([z.string(), z.object({ es: z.string(), en: z.string() })]);

const CtaSchema = z.object({
  label: LocalizedString,
  /** "whatsapp" abre wa.me con el mensaje general; "catalog" navega a /propiedades;
   *  "sell" navega a /vende-tu-propiedad; "form" hace scroll al formulario. */
  action: z.enum(["whatsapp", "catalog", "sell", "form"]),
});

// --------------------------- Secciones de la home ---------------------------

const base = { id: z.string(), enabled: z.boolean().default(true) };

export const HeroSectionSchema = z.object({
  ...base,
  type: z.literal("hero"),
  eyebrow: LocalizedString.optional(),
  title: LocalizedString,
  subtitle: LocalizedString.optional(),
  image: z.string(),
  imageAlt: z.string(),
  showSearch: z.boolean().default(true),
  cta: CtaSchema.optional(),
});

export const TrustBarSectionSchema = z.object({
  ...base,
  type: z.literal("trust-bar"),
  metrics: z
    .array(
      z.object({
        value: z.number(),
        prefix: z.string().optional(),
        suffix: z.string().optional(),
        label: LocalizedString,
        // "properties_count": el valor se reemplaza en runtime por el conteo
        // real de propiedades disponibles (value queda como respaldo si la
        // consulta falla). Evita numeros hardcodeados desactualizados.
        source: z.enum(["properties_count"]).optional(),
      })
    )
    .min(2)
    .max(4),
});

export const FeaturedPropertiesSectionSchema = z.object({
  ...base,
  type: z.literal("featured-properties"),
  eyebrow: LocalizedString.optional(),
  title: LocalizedString,
  subtitle: LocalizedString.optional(),
  count: z.number().min(3).max(6).default(6),
});

export const WhyUsSectionSchema = z.object({
  ...base,
  type: z.literal("why-us"),
  eyebrow: LocalizedString.optional(),
  title: LocalizedString,
  items: z
    .array(z.object({ title: LocalizedString, description: LocalizedString, icon: z.string().optional() }))
    .min(2)
    .max(4),
});

export const HowItWorksSectionSchema = z.object({
  ...base,
  type: z.literal("how-it-works"),
  eyebrow: LocalizedString.optional(),
  title: LocalizedString,
  steps: z.array(z.object({ title: LocalizedString, description: LocalizedString })).min(3).max(4),
});

export const SellCtaSectionSchema = z.object({
  ...base,
  type: z.literal("sell-cta"),
  eyebrow: LocalizedString.optional(),
  title: LocalizedString,
  subtitle: LocalizedString.optional(),
  ctaLabel: LocalizedString,
});

export const TestimonialsSectionSchema = z.object({
  ...base,
  type: z.literal("testimonials"),
  eyebrow: LocalizedString.optional(),
  title: LocalizedString,
  items: z
    .array(z.object({ name: z.string(), role: LocalizedString.optional(), quote: LocalizedString, result: LocalizedString.optional() }))
    .min(1)
    .max(6),
});

export const FinalCtaSectionSchema = z.object({
  ...base,
  type: z.literal("final-cta"),
  title: LocalizedString,
  subtitle: LocalizedString.optional(),
  showForm: z.boolean().default(true),
});

export const SectionConfigSchema = z.discriminatedUnion("type", [
  HeroSectionSchema,
  TrustBarSectionSchema,
  FeaturedPropertiesSectionSchema,
  WhyUsSectionSchema,
  HowItWorksSectionSchema,
  SellCtaSectionSchema,
  TestimonialsSectionSchema,
  FinalCtaSectionSchema,
]);

export type SectionConfig = z.infer<typeof SectionConfigSchema>;
export type SectionType = SectionConfig["type"];
export type SectionOfType<T extends SectionType> = Extract<SectionConfig, { type: T }>;

// ------------------------------- Tenant --------------------------------------

export const TenantConfigSchema = z.object({
  /** Clave del tenant (coincide con el registro en config/tenants/index.ts). */
  id: z.string(),

  brand: z.object({
    name: z.string(),
    legalName: z.string().optional(),
    tagline: LocalizedString,
    /** Rutas en /public o URLs absolutas. */
    logo: z.object({ light: z.string(), dark: z.string(), alt: z.string() }).optional(),
    /** Monograma para placeholders de imagen (1-2 letras). */
    monogram: z.string().min(1).max(2),
    city: z.string(),
    country: z.string().default("Colombia"),
  }),

  contact: z.object({
    whatsapp: z.object({
      /** E.164 sin "+", ej "573044653609". */
      number: z.string().regex(/^\d{10,15}$/),
      /** {ref} se reemplaza por la referencia de la propiedad. El par EN es la
       *  señal con la que Sofi detecta el idioma del lead — mantenerlo alineado
       *  con src/agent/intent.js:detectClientLanguage. */
      propertyMessage: LocalizedString,
      generalMessage: LocalizedString,
      sellerMessage: LocalizedString,
    }),
    phone: z.string().optional(),
    email: z.string().email().optional(),
    address: z.string().optional(),
    socials: z
      .object({
        instagram: z.string().url().optional(),
        facebook: z.string().url().optional(),
        tiktok: z.string().url().optional(),
        youtube: z.string().url().optional(),
      })
      .default({}),
  }),

  theme: z.object({
    colors: z.object({
      /** Fondo principal (paper) y texto principal (ink). */
      background: HexPair,
      foreground: HexPair,
      /** Superficies elevadas: cards, sheets. */
      surface: HexPair,
      /** Color de accion principal (botones solidos). */
      primary: HexPair,
      primaryForeground: HexPair,
      /** Acento de marca: lineas, badges, detalles. Nunca grandes areas. */
      accent: HexPair,
      accentForeground: HexPair,
      muted: HexPair,
      border: HexPair,
    }),
    fontPreset: z.enum(["elegant", "modern", "editorial", "geometric"]),
    radius: z.enum(["none", "sm", "md", "lg"]).default("md"),
    darkMode: z.enum(["system", "light-only", "dark-only"]).default("system"),
  }),

  seo: z.object({
    titleTemplate: z.string(),
    defaultTitle: z.string(),
    description: z.string(),
    keywords: z.array(z.string()).default([]),
    ogImage: z.string().optional(),
    baseUrl: z.string().url(),
  }),

  home: z.object({
    sections: z.array(SectionConfigSchema),
  }),

  catalog: z.object({
    title: LocalizedString,
    subtitle: LocalizedString.optional(),
    pageSize: z.number().min(6).max(24).default(12),
    defaultOperacion: z.enum(["Venta", "Arriendo", "todas"]).default("todas"),
  }),

  sellPage: z.object({
    enabled: z.boolean().default(true),
    title: LocalizedString,
    subtitle: LocalizedString.optional(),
    benefits: z.array(z.object({ title: LocalizedString, description: LocalizedString })).min(2).max(4),
    steps: z.array(z.object({ title: LocalizedString, description: LocalizedString })).min(3).max(4),
  }),

  /** Flags reservados para v2 — la arquitectura les deja espacio. */
  features: z
    .object({
      map: z.boolean().default(false),
      aiAssistant: z.boolean().default(false),
      comparator: z.boolean().default(false),
    })
    .default({}),

  integrations: z
    .object({
      metaPixelId: z.string().optional(),
      /** Contenido de <meta name="facebook-domain-verification">. Publico, fijo por tenant. */
      metaDomainVerification: z.string().optional(),
    })
    .default({}),
});

export type TenantConfigInput = z.input<typeof TenantConfigSchema>;
export type TenantConfig = z.infer<typeof TenantConfigSchema>;
