import type { TenantConfigInput } from "../tenant-schema";

// ---------------------------------------------------------------------------
// kubeta-preview — variante de Diamond Inmobiliaria con un tema visual
// inspirado en kubeta.com.co (paleta cálida/neutra, serif clásico,
// fotografía protagonista). SOLO para preview local (TENANT_ID=kubeta-preview),
// no está pensado para deploy. Mismo inventario/contacto real que "diamond".
// ---------------------------------------------------------------------------

export const kubetaPreview = {
  id: "kubeta-preview",

  brand: {
    name: "Diamond Inmobiliaria",
    tagline: { es: "Un hogar para cada forma de vivir", en: "A home for every way of living" },
    logo: { light: "/logo.png", dark: "/logo.png", alt: "Logo Diamond Inmobiliaria" },
    monogram: "D",
    city: "Medellín y toda Colombia",
    country: "Colombia",
  },

  contact: {
    whatsapp: {
      number: "573044653609",
      // Mismo par EN que diamond.ts — es la señal de idioma que detecta Sofi.
      propertyMessage: {
        es: "Hola, me interesa la propiedad {ref}",
        en: "Hi, I'm interested in property {ref}",
      },
      generalMessage: {
        es: "Hola, quiero información sobre sus propiedades",
        en: "Hi, I'd like information about your properties",
      },
      sellerMessage: {
        es: "Hola, quiero vender mi propiedad con ustedes",
        en: "Hi, I want to sell my property with you",
      },
    },
    socials: {
      instagram: "https://www.instagram.com/diamondinmobiliarialux/",
      facebook: "https://www.facebook.com/profile.php?id=61591477960096",
    },
  },

  theme: {
    colors: {
      // Paleta cálida/neutra tipo papel — inspirada en kubeta.com.co.
      background: { light: "#F5F1E8", dark: "#15130F" },
      foreground: { light: "#201B14", dark: "#F3EEE3" },
      surface: { light: "#FFFFFF", dark: "#1D1912" },
      primary: { light: "#201B14", dark: "#F3EEE3" },
      primaryForeground: { light: "#F5F1E8", dark: "#15130F" },
      accent: { light: "#A6642F", dark: "#C97D45" },
      accentForeground: { light: "#FFFFFF", dark: "#15130F" },
      muted: { light: "#7C7263", dark: "#A79C89" },
      border: { light: "#E6DFCF", dark: "#2C2820" },
    },
    fontPreset: "editorial",
    radius: "sm",
    darkMode: "system",
  },

  seo: {
    titleTemplate: "%s · Diamond Inmobiliaria (preview)",
    defaultTitle: "Diamond Inmobiliaria · Propiedades en Medellín y toda Colombia",
    description:
      "Casas, apartamentos y fincas seleccionadas en Medellín y toda Colombia. Propiedades verificadas y atención inmediata por WhatsApp.",
    keywords: ["inmobiliaria Medellín", "inmobiliaria Colombia"],
    // localhost a proposito: este tenant es SOLO preview local. Si algun dia
    // se despliega, cambiar a su dominio real — nunca al de produccion de
    // Diamond (canonical/sitemap/OG apuntarian al sitio real con "(preview)").
    baseUrl: "http://localhost:3000",
  },

  home: {
    sections: [
      {
        id: "hero",
        type: "hero",
        enabled: true,
        eyebrow: "Diamond Inmobiliaria",
        title: { es: "Un hogar para cada forma de vivir", en: "A home for every way of living" },
        subtitle: {
          es: "Casas, apartamentos y fincas seleccionadas en Medellín y toda Colombia, con acompañamiento cercano en cada paso.",
          en: "Curated houses, apartments and country homes in Medellín and all of Colombia, with close guidance at every step.",
        },
        image:
          "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?q=80&w=2400&auto=format&fit=crop",
        imageAlt: "Fachada cálida de casa moderna al atardecer",
        showSearch: true,
      },
      {
        id: "trust",
        type: "trust-bar",
        enabled: true,
        metrics: [
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
        eyebrow: { es: "Por qué elegirnos", en: "Why choose us" },
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
        // Habilitado solo en este tenant de preview para mostrar la seccion
        // visualmente. En "diamond" (produccion) permanece apagada hasta
        // tener testimonios reales.
        enabled: true,
        eyebrow: { es: "Clientes", en: "Clients" },
        title: { es: "Historias que terminaron en llaves", en: "Stories that ended in keys" },
        // DATOS DE MUESTRA para que la seccion se vea completa en el preview.
        // Antes de usar en cualquier sitio publico, reemplazar por
        // testimonios reales y verificables.
        items: [
          {
            name: "Carolina M. (ejemplo)",
            quote: {
              es: "Escribí un domingo por la noche y en minutos ya tenía opciones que sí encajaban con lo que buscaba. Nunca sentí presión, solo acompañamiento.",
              en: "I wrote on a Sunday night and within minutes I had options that actually fit what I was looking for. I never felt pressured, just supported.",
            },
            result: { es: "Compró apartamento en Envigado", en: "Bought an apartment in Envigado" },
          },
          {
            name: "Andrés y Laura (ejemplo)",
            quote: {
              es: "Nos coordinaron las visitas, nos ayudaron con el crédito y estuvieron pendientes hasta la firma. Se nota que conocen su inventario.",
              en: "They coordinated the visits, helped us with financing and stayed on top of everything until signing. You can tell they know their inventory.",
            },
            result: { es: "Compraron casa en La Estrella", en: "Bought a house in La Estrella" },
          },
          {
            name: "Familia Restrepo (ejemplo)",
            quote: {
              es: "Publicamos la finca con ellos y solo nos llegaron interesados de verdad. El proceso fue mucho más tranquilo de lo que esperábamos.",
              en: "We listed our country home with them and only heard from genuinely interested buyers. The process was far calmer than we expected.",
            },
            result: { es: "Vendieron finca en el Oriente", en: "Sold a country home in Oriente" },
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
  integrations: {},
} satisfies TenantConfigInput;
