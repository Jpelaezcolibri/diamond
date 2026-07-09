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
    tagline: "Un hogar para cada forma de vivir",
    logo: { light: "/logo.png", dark: "/logo.png", alt: "Logo Diamond Inmobiliaria" },
    monogram: "D",
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
        title: "Un hogar para cada forma de vivir",
        subtitle:
          "Casas, apartamentos y fincas seleccionadas en Medellín y toda Colombia, con acompañamiento cercano en cada paso.",
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
          { value: 38, suffix: "+", label: "Propiedades disponibles", source: "properties_count" },
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
        eyebrow: "Por qué elegirnos",
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
        // Habilitado solo en este tenant de preview para mostrar la seccion
        // visualmente. En "diamond" (produccion) permanece apagada hasta
        // tener testimonios reales.
        enabled: true,
        eyebrow: "Clientes",
        title: "Historias que terminaron en llaves",
        // DATOS DE MUESTRA para que la seccion se vea completa en el preview.
        // Antes de usar en cualquier sitio publico, reemplazar por
        // testimonios reales y verificables.
        items: [
          {
            name: "Carolina M. (ejemplo)",
            quote:
              "Escribí un domingo por la noche y en minutos ya tenía opciones que sí encajaban con lo que buscaba. Nunca sentí presión, solo acompañamiento.",
            result: "Compró apartamento en Envigado",
          },
          {
            name: "Andrés y Laura (ejemplo)",
            quote:
              "Nos coordinaron las visitas, nos ayudaron con el crédito y estuvieron pendientes hasta la firma. Se nota que conocen su inventario.",
            result: "Compraron casa en La Estrella",
          },
          {
            name: "Familia Restrepo (ejemplo)",
            quote:
              "Publicamos la finca con ellos y solo nos llegaron interesados de verdad. El proceso fue mucho más tranquilo de lo que esperábamos.",
            result: "Vendieron finca en el Oriente",
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
  integrations: {},
} satisfies TenantConfigInput;
