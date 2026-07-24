import type { TenantConfigInput } from "../tenant-schema";

// ---------------------------------------------------------------------------
// Diamond Inmobiliaria — primer tenant real de REF.
// Inventario: Supabase (39 propiedades Wasi). WhatsApp: Sofi (+57 304 4653609).
// ---------------------------------------------------------------------------

export const diamond = {
  id: "diamond",

  brand: {
    name: "Diamond Inmobiliaria",
    tagline: {
      es: "Propiedades seleccionadas en Medellín y toda Colombia",
      en: "Curated properties in Medellín and all of Colombia",
    },
    logo: { light: "/logo.png", dark: "/logo.png", alt: "Logo Diamond Inmobiliaria" },
    monogram: "D",
    // Marca con alcance nacional (decisión comercial del propietario). El
    // inventario hoy se concentra en Antioquia (Medellín/Valle de Aburrá,
    // oriente y occidente), con presencia en otras zonas del país.
    city: "Medellín y toda Colombia",
    country: "Colombia",
  },

  contact: {
    whatsapp: {
      number: "573044653609",
      propertyMessage: "Hola, me interesa la propiedad {ref}",
      generalMessage: "Hola, quiero información sobre sus propiedades",
      sellerMessage: "Hola, quiero vender mi propiedad con ustedes",
    },
    socials: {
      instagram: "https://www.instagram.com/diamondinmobiliarialux/",
      facebook: "https://www.facebook.com/profile.php?id=61591477960096",
    },
  },

  theme: {
    colors: {
      background: { light: "#FAF9F6", dark: "#101012" },
      foreground: { light: "#101012", dark: "#F4F2ED" },
      surface: { light: "#FFFFFF", dark: "#18181B" },
      primary: { light: "#101012", dark: "#F4F2ED" },
      primaryForeground: { light: "#FAF9F6", dark: "#101012" },
      accent: { light: "#C9A24B", dark: "#B8964A" },
      accentForeground: { light: "#101012", dark: "#101012" },
      muted: { light: "#6E6A63", dark: "#A19C93" },
      border: { light: "#E7E3DB", dark: "#2A2A2E" },
    },
    fontPreset: "elegant",
    radius: "md",
    darkMode: "system",
  },

  seo: {
    titleTemplate: "%s · Diamond Inmobiliaria",
    defaultTitle: "Diamond Inmobiliaria · Propiedades en Medellín y toda Colombia",
    description:
      "Casas, apartamentos y fincas seleccionadas en Medellín y toda Colombia. Propiedades verificadas y atención inmediata por WhatsApp.",
    keywords: [
      "inmobiliaria Medellín",
      "inmobiliaria Colombia",
      "finca raíz Colombia",
      "apartamentos en venta Medellín",
      "casas en venta Colombia",
    ],
    baseUrl: "https://diamondinmobiliaria.com",
  },

  home: {
    sections: [
      {
        id: "hero",
        type: "hero",
        enabled: true,
        eyebrow: "Diamond Inmobiliaria",
        title: {
          es: "El hogar que mereces, en toda Colombia",
          en: "The home you deserve, anywhere in Colombia",
        },
        subtitle: {
          es: "Desde Medellín para todo el país: propiedades verificadas y acompañamiento real en cada paso.",
          en: "From Medellín to the whole country: verified properties and real guidance at every step.",
        },
        image:
          "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?q=80&w=2400&auto=format&fit=crop",
        imageAlt: "Casa moderna con jardín al atardecer",
        showSearch: true,
      },
      {
        id: "trust",
        type: "trust-bar",
        enabled: true,
        metrics: [
          // El conteo se resuelve en vivo desde la base (value = respaldo si falla).
          // Respaldo alineado al inventario real (~39) — nunca inflar la cifra.
          {
            value: 38,
            suffix: "+",
            label: { es: "Propiedades disponibles", en: "Available properties" },
            source: "properties_count",
          },
          { value: 24, suffix: "/7", label: { es: "Atención por WhatsApp", en: "WhatsApp support" } },
          { value: 1, suffix: " min", label: { es: "Tiempo de respuesta", en: "Response time" } },
        ],
      },
      {
        id: "featured",
        type: "featured-properties",
        enabled: true,
        eyebrow: { es: "Selección", en: "Selection" },
        title: { es: "Propiedades destacadas", en: "Featured properties" },
        subtitle: {
          es: "Una curaduría de nuestro inventario en Medellín y toda Colombia.",
          en: "A curated pick from our inventory in Medellín and all of Colombia.",
        },
        count: 6,
      },
      {
        id: "why-us",
        type: "why-us",
        enabled: true,
        eyebrow: { es: "Por qué Diamond", en: "Why Diamond" },
        title: {
          es: "Comprar bien empieza por estar bien acompañado",
          en: "Buying well starts with the right guidance",
        },
        items: [
          {
            title: { es: "Respuesta inmediata, a cualquier hora", en: "Immediate response, any time" },
            description: {
              es: "Sofi, nuestra asistente, te atiende por WhatsApp en segundos y te conecta con un asesor humano cuando lo necesites.",
              en: "Sofi, our assistant, replies on WhatsApp in seconds and connects you with a human advisor whenever you need one.",
            },
            icon: "message-circle",
          },
          {
            title: { es: "Inventario real y verificado", en: "Real, verified inventory" },
            description: {
              es: "Cada propiedad publicada existe, está disponible y tiene su ficha completa. Nunca verás un aviso fantasma.",
              en: "Every listing exists, is available and has a complete profile. You will never see a ghost listing.",
            },
            icon: "badge-check",
          },
          {
            title: { es: "Asesores por especialidad", en: "Advisors by specialty" },
            description: {
              es: "Venta y arriendo son mundos distintos. Te atiende el asesor que conoce el tuyo, de la visita al cierre.",
              en: "Buying and renting are different worlds. You get the advisor who knows yours, from the visit to the closing.",
            },
            icon: "users",
          },
        ],
      },
      {
        id: "how",
        type: "how-it-works",
        enabled: true,
        eyebrow: { es: "Cómo funciona", en: "How it works" },
        title: {
          es: "De la búsqueda a las llaves en cuatro pasos",
          en: "From search to keys in four steps",
        },
        steps: [
          {
            title: { es: "Cuéntanos qué buscas", en: "Tell us what you're looking for" },
            description: {
              es: "Usa el buscador o escríbenos por WhatsApp. Zona, presupuesto y lo que no puede faltar.",
              en: "Use the search or message us on WhatsApp. Area, budget and your must-haves.",
            },
          },
          {
            title: { es: "Recibe opciones seleccionadas", en: "Get hand-picked options" },
            description: {
              es: "Nada de catálogos infinitos: te enviamos solo las propiedades que encajan contigo.",
              en: "No endless catalogs: we only send you the properties that truly fit you.",
            },
          },
          {
            title: { es: "Visita con un asesor", en: "Visit with an advisor" },
            description: {
              es: "Coordinamos las visitas y te acompañamos para que veas cada detalle con calma.",
              en: "We coordinate the visits and walk you through every detail, at your pace.",
            },
          },
          {
            title: { es: "Cierra con respaldo", en: "Close with full support" },
            description: {
              es: "Estudio de documentos, negociación y crédito: te acompañamos hasta la firma.",
              en: "Document review, negotiation and financing: we're with you all the way to signing.",
            },
          },
        ],
      },
      {
        id: "sell",
        type: "sell-cta",
        enabled: true,
        eyebrow: { es: "Para propietarios", en: "For property owners" },
        title: {
          es: "¿Tienes una propiedad para vender o arrendar?",
          en: "Do you have a property to sell or rent out?",
        },
        subtitle: {
          es: "La publicamos con fotografía profesional, la promovemos con pauta digital y filtramos a los interesados por ti.",
          en: "We list it with professional photography, promote it with digital ads and screen the prospects for you.",
        },
        ctaLabel: { es: "Vende tu propiedad con nosotros", en: "Sell your property with us" },
      },
      {
        id: "testimonials",
        type: "testimonials",
        // Activar cuando existan testimonios reales de clientes Diamond.
        enabled: false,
        eyebrow: { es: "Clientes", en: "Clients" },
        title: { es: "Historias que terminaron en llaves", en: "Stories that ended in keys" },
        items: [
          {
            name: "EJEMPLO — Reemplazar con testimonio real",
            quote: "Texto del testimonio real del cliente.",
            result: "Compró apartamento en Envigado",
          },
        ],
      },
      {
        id: "final-cta",
        type: "final-cta",
        enabled: true,
        title: { es: "Hablemos de tu próxima propiedad", en: "Let's talk about your next property" },
        subtitle: {
          es: "Déjanos tus datos y un asesor te escribe por WhatsApp, o escríbenos directamente.",
          en: "Leave us your details and an advisor will message you on WhatsApp, or write to us directly.",
        },
        showForm: true,
      },
    ],
  },

  catalog: {
    title: { es: "Propiedades", en: "Properties" },
    subtitle: {
      es: "Inventario disponible en Medellín y toda Colombia.",
      en: "Available inventory in Medellín and all of Colombia.",
    },
    pageSize: 12,
    defaultOperacion: "todas",
  },

  sellPage: {
    enabled: true,
    title: { es: "Vende tu propiedad con Diamond", en: "Sell your property with Diamond" },
    subtitle: {
      es: "Publicación profesional, difusión con pauta digital y filtro de interesados. Tú decides, nosotros hacemos el trabajo.",
      en: "Professional listing, digital ad promotion and prospect screening. You decide, we do the work.",
    },
    benefits: [
      {
        title: { es: "Publicación profesional", en: "Professional listing" },
        description: {
          es: "Ficha completa estilo revista: fotografía cuidada, datos verificados y presentación impecable.",
          en: "A complete magazine-style profile: polished photography, verified data and impeccable presentation.",
        },
      },
      {
        title: { es: "Difusión que sí llega", en: "Promotion that actually reaches" },
        description: {
          es: "Tu propiedad en portales, redes y campañas de pauta segmentada en tu zona.",
          en: "Your property on portals, social media and targeted ad campaigns in your area.",
        },
      },
      {
        title: { es: "Solo interesados reales", en: "Only real prospects" },
        description: {
          es: "Sofi filtra a los curiosos: a ti solo te llegan personas calificadas y con intención.",
          en: "Sofi filters out the curious: you only hear from qualified people with real intent.",
        },
      },
    ],
    steps: [
      {
        title: { es: "Cuéntanos de tu propiedad", en: "Tell us about your property" },
        description: {
          es: "Ubicación, características y tus expectativas de precio.",
          en: "Location, features and your price expectations.",
        },
      },
      {
        title: { es: "La valoramos juntos", en: "We value it together" },
        description: {
          es: "Análisis de mercado real para definir un precio que sí vende.",
          en: "Real market analysis to set a price that actually sells.",
        },
      },
      {
        title: { es: "La promovemos por ti", en: "We promote it for you" },
        description: {
          es: "Fotos, publicación, pauta y visitas coordinadas por nuestro equipo.",
          en: "Photos, listing, ads and visits coordinated by our team.",
        },
      },
      {
        title: { es: "Cierras con respaldo", en: "You close with full support" },
        description: {
          es: "Negociación y papeles con acompañamiento jurídico completo.",
          en: "Negotiation and paperwork with complete legal guidance.",
        },
      },
    ],
  },

  features: { map: false, aiAssistant: false, comparator: false },
  // Pixel ID via env: se pega en Vercel sin tocar codigo. Vacio = Pixel apagado.
  integrations: {
    metaPixelId: process.env.NEXT_PUBLIC_META_PIXEL_ID,
    // Verificacion del dominio diamondinmobiliaria.com en Meta (Vertice Studio).
    metaDomainVerification: "42evdyqf11w2jr91ddlmomeih3d5so",
  },
} satisfies TenantConfigInput;
