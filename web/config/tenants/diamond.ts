import type { TenantConfigInput } from "../tenant-schema";

// ---------------------------------------------------------------------------
// Diamond Inmobiliaria — primer tenant real de REF.
// Inventario: Supabase (39 propiedades Wasi). WhatsApp: Sofi (+57 304 4653609).
// ---------------------------------------------------------------------------

export const diamond = {
  id: "diamond",

  brand: {
    name: "Diamond Inmobiliaria",
    tagline: "Propiedades seleccionadas en Medellín y toda Colombia",
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
      facebook: "https://web.facebook.com/profile.php?id=61590636426343",
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
        title: "El hogar que mereces, en toda Colombia",
        subtitle:
          "Desde Medellín para todo el país: propiedades verificadas y acompañamiento real en cada paso.",
        image:
          "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?q=80&w=2400&auto=format&fit=crop",
        imageAlt: "Casa moderna con jardín al atardecer",
        showSearch: true,
      },
      {
        id: "trust",
        type: "trust-bar",
        enabled: true,
        // Ajustar con cifras reales de Diamond cuando esten disponibles.
        metrics: [
          { value: 39, suffix: "+", label: "Propiedades disponibles" },
          { value: 24, suffix: "/7", label: "Atención por WhatsApp" },
          { value: 1, suffix: " min", label: "Tiempo de respuesta" },
        ],
      },
      {
        id: "featured",
        type: "featured-properties",
        enabled: true,
        eyebrow: "Selección",
        title: "Propiedades destacadas",
        subtitle: "Una curaduría de nuestro inventario en Medellín y toda Colombia.",
        count: 6,
      },
      {
        id: "why-us",
        type: "why-us",
        enabled: true,
        eyebrow: "Por qué Diamond",
        title: "Comprar bien empieza por estar bien acompañado",
        items: [
          {
            title: "Respuesta inmediata, a cualquier hora",
            description:
              "Sofi, nuestra asistente, te atiende por WhatsApp en segundos y te conecta con un asesor humano cuando lo necesites.",
            icon: "message-circle",
          },
          {
            title: "Inventario real y verificado",
            description:
              "Cada propiedad publicada existe, está disponible y tiene su ficha completa. Nunca verás un aviso fantasma.",
            icon: "badge-check",
          },
          {
            title: "Asesores por especialidad",
            description:
              "Venta y arriendo son mundos distintos. Te atiende el asesor que conoce el tuyo, de la visita al cierre.",
            icon: "users",
          },
        ],
      },
      {
        id: "how",
        type: "how-it-works",
        enabled: true,
        eyebrow: "Cómo funciona",
        title: "De la búsqueda a las llaves en cuatro pasos",
        steps: [
          {
            title: "Cuéntanos qué buscas",
            description: "Usa el buscador o escríbenos por WhatsApp. Zona, presupuesto y lo que no puede faltar.",
          },
          {
            title: "Recibe opciones seleccionadas",
            description: "Nada de catálogos infinitos: te enviamos solo las propiedades que encajan contigo.",
          },
          {
            title: "Visita con un asesor",
            description: "Coordinamos las visitas y te acompañamos para que veas cada detalle con calma.",
          },
          {
            title: "Cierra con respaldo",
            description: "Estudio de documentos, negociación y crédito: te acompañamos hasta la firma.",
          },
        ],
      },
      {
        id: "sell",
        type: "sell-cta",
        enabled: true,
        eyebrow: "Para propietarios",
        title: "¿Tienes una propiedad para vender o arrendar?",
        subtitle:
          "La publicamos con fotografía profesional, la promovemos con pauta digital y filtramos a los interesados por ti.",
        ctaLabel: "Vende tu propiedad con nosotros",
      },
      {
        id: "testimonials",
        type: "testimonials",
        // Activar cuando existan testimonios reales de clientes Diamond.
        enabled: false,
        eyebrow: "Clientes",
        title: "Historias que terminaron en llaves",
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
        title: "Hablemos de tu próxima propiedad",
        subtitle: "Déjanos tus datos y un asesor te escribe por WhatsApp, o escríbenos directamente.",
        showForm: true,
      },
    ],
  },

  catalog: {
    title: "Propiedades",
    subtitle: "Inventario disponible en Medellín y toda Colombia.",
    pageSize: 12,
    defaultOperacion: "todas",
  },

  sellPage: {
    enabled: true,
    title: "Vende tu propiedad con Diamond",
    subtitle: "Publicación profesional, difusión con pauta digital y filtro de interesados. Tú decides, nosotros hacemos el trabajo.",
    benefits: [
      {
        title: "Publicación profesional",
        description: "Ficha completa estilo revista: fotografía cuidada, datos verificados y presentación impecable.",
      },
      {
        title: "Difusión que sí llega",
        description: "Tu propiedad en portales, redes y campañas de pauta segmentada en tu zona.",
      },
      {
        title: "Solo interesados reales",
        description: "Sofi filtra a los curiosos: a ti solo te llegan personas calificadas y con intención.",
      },
    ],
    steps: [
      { title: "Cuéntanos de tu propiedad", description: "Ubicación, características y tus expectativas de precio." },
      { title: "La valoramos juntos", description: "Análisis de mercado real para definir un precio que sí vende." },
      { title: "La promovemos por ti", description: "Fotos, publicación, pauta y visitas coordinadas por nuestro equipo." },
      { title: "Cierras con respaldo", description: "Negociación y papeles con acompañamiento jurídico completo." },
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
