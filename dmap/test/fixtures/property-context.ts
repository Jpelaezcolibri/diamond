import type { PropertyRow } from "../../src/repositories/properties.repo.js";
import type { AudienceAnalysisOutput, NarrativeDirectionOutput, PropertyContext } from "../../src/cognitive/domain/property-context.js";
import { deriveContext } from "../../src/cognitive/application/derive.rules.js";

export const propertyFixture: PropertyRow = {
  id: "11111111-1111-1111-1111-111111111111",
  org_id: "22222222-2222-2222-2222-222222222222",
  ref: "AP001",
  titulo: "Apartamento en Sabaneta",
  tipo: "Apartamento",
  operacion: "Venta",
  precio: "$460.000.000",
  area: "65m2",
  habitaciones: 2,
  banos: 2,
  garaje: 1,
  estrato: 4,
  administracion: "$280.000",
  zona: "El Carmelo",
  ciudad: "Sabaneta",
  descripcion: "Muy iluminado, cerca al parque",
  caracteristicas: "Balcon\nGimnasio\nPortería 24h",
  link: "https://info.wasi.co/ap001",
  disponible: true,
  images: ["https://cdn.example.com/1.jpg", "https://cdn.example.com/2.jpg"],
  created_at: "2026-07-01T00:00:00Z"
};

export const audienceAnalysisFixture: AudienceAnalysisOutput = {
  audience: {
    buyerPersonaPrimary: {
      id: "familia_consolidacion",
      label: "Familia en consolidación",
      descripcion: "Pareja con un hijo pequeño que busca su primer apartamento propio en Sabaneta",
      edad: "30-45",
      motivacion: "Dejar de arrendar y echar raíces cerca del parque de Sabaneta"
    },
    buyerPersonaSecondary: null,
    investmentProfile: {
      esOportunidadInversion: false,
      razon: "Precio en línea con el mercado de la zona",
      rentabilidadNarrativa: null
    },
    lifestyle: ["Vida de barrio tranquila", "Caminar al parque", "Gimnasio en la unidad"]
  },
  emotional: {
    mainEmotion: "seguridad",
    secondaryEmotion: "pertenencia",
    benefits: [
      { beneficio: "Tranquilidad de portería 24h", featureOrigen: "Portería 24h", paraPersona: "primary" },
      { beneficio: "Luz natural todo el día", featureOrigen: "Muy iluminado", paraPersona: "ambas" }
    ],
    objections: [{ objecion: "La administración parece alta", respuesta: "Incluye gimnasio y portería 24h" }],
    trustArguments: ["Estrato 4 consolidado", "Zona con demanda estable"],
    urgencyLevel: "media",
    urgencyRationale: "Sabaneta tiene rotación media de inventario en este rango"
  }
};

export const narrativeDirectionFixture: NarrativeDirectionOutput = {
  narrative: {
    storyAngle: "El primer apartamento propio de la familia, a pasos del parque",
    heroMessage: "Tu familia, por fin en casa propia",
    heroSubtitle: "2 habitaciones llenas de luz frente al parque de Sabaneta",
    heroVariants: [
      {
        personaId: "familia_consolidacion",
        heroMessage: "Tu familia, por fin en casa propia",
        heroSubtitle: "2 habitaciones llenas de luz frente al parque"
      }
    ],
    ctaStyle: { primario: "Agenda tu visita", whatsapp: "Escríbenos por WhatsApp" }
  },
  voice: {
    tonePerChannel: {
      landing: "Cálido y concreto, hablando de la vida diaria de la familia",
      facebook: "Conversacional, primera persona plural",
      instagram: "Corto y visual, emoción primero",
      email: "Cercano, con datos al final",
      whatsapp: "Directo y amable",
      blog: "Informativo con ejemplos de la zona"
    }
  },
  creative: {
    visualStyle: "Editorial claro y luminoso",
    colorPsychology: "Blancos y maderas cálidas que transmiten hogar",
    creativeDirection: "Mostrar la sala iluminada como corazón del hogar, texto mínimo en franja inferior",
    imageMood: "Mañana soleada de día de mudanza",
    styleVariantEquivalente: "familiar"
  },
  recommendations: {
    campaign: { objetivo: "Leads por WhatsApp", angulo: "Deja de arrendar en Sabaneta" },
    audience: { descripcion: "Parejas 30-45 en el sur del Valle de Aburrá", edades: "30-45", intereses: ["Vivienda nueva", "Sabaneta"] },
    keywords: ["apartamento en venta sabaneta", "apartamento el carmelo"],
    hashtags: ["#Sabaneta", "#ApartamentoEnVenta"],
    blogTopics: ["Por qué Sabaneta es ideal para familias jóvenes"],
    emailSequenceHint: "Bienvenida con la historia del sector, luego beneficios, luego visita",
    seoTitle: "Apartamento en venta en Sabaneta · $460.000.000",
    seoDescription: "Apartamento de 2 habitaciones y 65m2 en El Carmelo, Sabaneta. Portería 24h y gimnasio."
  }
};

export const propertyContextFixture: PropertyContext = {
  ...audienceAnalysisFixture,
  ...narrativeDirectionFixture,
  derived: deriveContext(propertyFixture)
};
