import type { TenantConfigInput } from "../tenant-schema";

// ---------------------------------------------------------------------------
// Horizonte — tenant DEMO ficticio. Prueba viva de que REF se re-tematiza
// completo (marca, colores, tipografia, textos, secciones) solo con config.
// Se activa con TENANT_ID=demo. Usa el inventario de muestra (sin Supabase).
// ---------------------------------------------------------------------------

export const demo = {
  id: "demo",

  brand: {
    name: "Horizonte Propiedad Raíz",
    tagline: "Vivir bien no debería ser tan difícil de encontrar",
    monogram: "H",
    city: "Bogotá",
    country: "Colombia",
  },

  contact: {
    whatsapp: {
      number: "573001112233",
      propertyMessage: "Hola, vi la propiedad {ref} en su página y quiero más información",
      generalMessage: "Hola, estoy buscando propiedad y quiero asesoría",
      sellerMessage: "Hola, quiero vender mi propiedad con Horizonte",
    },
    socials: {},
  },

  theme: {
    colors: {
      background: { light: "#F7F8F6", dark: "#0E1210" },
      foreground: { light: "#141A16", dark: "#EEF2EE" },
      surface: { light: "#FFFFFF", dark: "#161C18" },
      primary: { light: "#1E3A2F", dark: "#DCE8DF" },
      primaryForeground: { light: "#F7F8F6", dark: "#0E1210" },
      accent: { light: "#3E7C59", dark: "#5FA07C" },
      accentForeground: { light: "#F7F8F6", dark: "#0E1210" },
      muted: { light: "#5E6A62", dark: "#9AA79E" },
      border: { light: "#E2E7E2", dark: "#252D28" },
    },
    fontPreset: "geometric",
    radius: "lg",
    darkMode: "system",
  },

  seo: {
    titleTemplate: "%s · Horizonte",
    defaultTitle: "Horizonte Propiedad Raíz · Encuentra tu lugar en Bogotá",
    description: "Apartamentos y casas seleccionadas en Bogotá. Demo del Real Estate Experience Framework.",
    keywords: ["inmobiliaria Bogotá", "apartamentos en venta Bogotá"],
    baseUrl: "https://ref-demo.vercel.app",
  },

  home: {
    sections: [
      {
        id: "hero",
        type: "hero",
        enabled: true,
        eyebrow: "Horizonte",
        title: "Tu próxima dirección está más cerca de lo que crees",
        subtitle: "Propiedades seleccionadas en Bogotá, con asesoría de verdad.",
        image:
          "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?q=80&w=2400&auto=format&fit=crop",
        imageAlt: "Interior luminoso de apartamento moderno",
        showSearch: true,
      },
      {
        id: "trust",
        type: "trust-bar",
        enabled: true,
        metrics: [
          { value: 120, suffix: "+", label: "Familias acompañadas" },
          { value: 8, label: "Años de experiencia" },
          { value: 4.9, label: "Calificación promedio" },
        ],
      },
      {
        id: "featured",
        type: "featured-properties",
        enabled: true,
        eyebrow: "Selección",
        title: "Destacadas de la semana",
        count: 3,
      },
      {
        id: "sell",
        type: "sell-cta",
        enabled: true,
        eyebrow: "Propietarios",
        title: "Tu propiedad merece venderse mejor",
        ctaLabel: "Quiero venderla con Horizonte",
      },
      {
        id: "final-cta",
        type: "final-cta",
        enabled: true,
        title: "Empecemos hoy",
        subtitle: "Cuéntanos qué buscas y te respondemos en minutos.",
        showForm: true,
      },
    ],
  },

  catalog: {
    title: "Propiedades",
    subtitle: "Inventario de muestra del framework.",
    pageSize: 12,
    defaultOperacion: "todas",
  },

  sellPage: {
    enabled: true,
    title: "Vende tu propiedad con Horizonte",
    benefits: [
      { title: "Publicación impecable", description: "Fotografía y ficha profesional de tu inmueble." },
      { title: "Compradores filtrados", description: "Solo te presentamos interesados con intención real." },
    ],
    steps: [
      { title: "Cuéntanos de tu inmueble", description: "Datos básicos y expectativa de precio." },
      { title: "Definimos el precio", description: "Con análisis de mercado de tu zona." },
      { title: "Lo promovemos", description: "Portales, redes y nuestra base de compradores." },
    ],
  },

  features: {},
  integrations: {},
} satisfies TenantConfigInput;
