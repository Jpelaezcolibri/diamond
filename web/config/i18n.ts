// Diccionario de la interfaz estatica de la landing (nav, formularios,
// footer, buscador, paginas de propiedad/404). NO cubre: titulo/descripcion
// de las propiedades (vienen de Wasi/DCE, siempre en espanol) ni metadata SEO
// (se genera en el servidor antes de que exista el idioma del cliente).
// Ver docs/superpowers/specs/2026-07-24-toggle-idioma-design.md.
//
// Tipado espejado: si falta una clave en un idioma, TypeScript lo marca en
// build — no hay forma de que una traduccion faltante llegue a produccion
// en silencio.
export const dictionary = {
  es: {
    nav: {
      home: "Inicio",
      properties: "Propiedades",
      sell: "Vende tu propiedad",
      whatsapp: "WhatsApp",
      whatsappMobile: "Hablemos por WhatsApp",
      openMenu: "Abrir menú",
      closeMenu: "Cerrar menú",
    },
    whatsappFab: {
      label: "Escríbenos por WhatsApp",
    },
    heroSearch: {
      operationAll: "Comprar o arrendar",
      operationBuy: "Comprar",
      operationRent: "Arrendar",
      placeholder: "¿Dónde quieres vivir? Zona, barrio o ciudad",
      submit: "Buscar",
    },
    filterBar: {
      operation: "Operación",
      type: "Tipo de inmueble",
      typeShort: "Tipo",
      zone: "Zona",
      priceMax: "Precio máximo",
      priceMaxShort: "Precio máx.",
      rooms: "Habitaciones mínimas",
      roomsShort: "Habitaciones",
      roomsPlus: "{n}+ hab",
      order: "Ordenar",
      orderRecent: "Más recientes",
      orderPriceAsc: "Menor precio",
      orderPriceDesc: "Mayor precio",
      orderAreaDesc: "Mayor área",
      clearAll: "Limpiar todo",
      updating: "Actualizando resultados…",
      upToPrice: "Hasta {price}",
    },
    leadForm: {
      name: "Nombre",
      namePlaceholder: "¿Cómo te llamas?",
      phone: "Celular (WhatsApp)",
      operation: "Qué quieres hacer",
      operationBuy: "Comprar",
      operationRent: "Arrendar",
      operationSell: "Vender mi propiedad",
      zone: "Zona de interés (opcional)",
      zonePlaceholder: "Envigado, Sabaneta…",
      budget: "Presupuesto aproximado (opcional)",
      budgetPlaceholder: "Ej: entre 300 y 500 millones",
      honeypot: "No llenar este campo",
      sending: "Enviando…",
      submit: "Continuar en WhatsApp",
      disclaimer: "Al enviar aceptas ser contactado por WhatsApp. Tus datos no se comparten con terceros.",
      successTitle: "¡Listo! Te estamos abriendo WhatsApp…",
      successBody: "Si no se abre automáticamente, escríbenos directo y te atendemos de una.",
      errorBody: "No pudimos enviar tus datos. Intenta de nuevo o escríbenos directo por WhatsApp.",
    },
    emptyState: {
      notFoundTitle: "Esta página no existe (o la propiedad ya no está disponible)",
      notFoundDescription:
        "Puede que el inmueble se haya vendido o arrendado. Nuestro inventario cambia todos los días — mira lo que hay disponible o cuéntanos qué buscas.",
      noResultsTitle: "No encontramos propiedades con esos filtros",
      noResultsDescription:
        "Prueba ampliando la zona o el presupuesto. También puedes contarnos qué buscas y te avisamos cuando llegue al inventario.",
      viewAll: "Ver todas las propiedades",
      tellUs: "Cuéntanos qué buscas",
    },
    propertyGallery: {
      expandMain: "Ampliar foto principal",
      photosCount: "{n} fotos",
      expandN: "Ampliar foto {n}",
      galleryOf: "Galería de {title}",
      close: "Cerrar galería",
      prev: "Foto anterior",
      next: "Foto siguiente",
    },
    catalogPage: {
      countOne: "{n} propiedad",
      countOther: "{n} propiedades",
      noResults: "Sin resultados con estos filtros",
    },
    footer: {
      explore: "Explora",
      forSale: "En venta",
      forRent: "En arriendo",
      contact: "Contacto",
      rights: "Todos los derechos reservados.",
    },
    propertySpecs: {
      sqm: "{n} metros cuadrados",
      rooms: "{n} habitaciones",
      baths: "{n} baños",
      parking: "{n} parqueaderos",
    },
    home: {
      step: "Paso {n}:",
    },
    sellPageUi: {
      eyebrow: "Para propietarios",
      whatsappCta: "Cuéntanos de tu propiedad",
      how: "Así funciona",
      valuationTitle: "Empecemos con una valoración sin compromiso",
      valuationBody:
        "Déjanos tus datos y un asesor te contacta para conocer tu propiedad y darte un estimado real de mercado. Sin costos ocultos, sin exclusividades forzadas.",
    },
    pagination: {
      nav: "Paginación",
      prev: "Página anterior",
      next: "Página siguiente",
    },
    propertyPage: {
      newBadge: "Nuevo",
      ref: "Ref.",
      perMonth: "/ mes",
      admin: "Administración:",
      estrato: "Estrato",
      about: "Sobre esta propiedad",
      whyLove: "Por qué te va a encantar",
      features: "Características",
      viewOriginal: "Ver ficha original",
      similar: "Propiedades similares",
      interested: "¿Te interesa esta propiedad?",
      talkToTeam: "Habla ya con nuestro equipo",
      wantToSee: "Quiero verla — WhatsApp",
      wantToSeeShort: "Quiero verla",
      immediateResponse: "Respuesta inmediata · Ref. {ref} precargada",
      preferContact: "Prefiero que me contacten →",
      backToProperties: "Volver a propiedades",
    },
  },
  en: {
    nav: {
      home: "Home",
      properties: "Properties",
      sell: "Sell your property",
      whatsapp: "WhatsApp",
      whatsappMobile: "Chat with us on WhatsApp",
      openMenu: "Open menu",
      closeMenu: "Close menu",
    },
    whatsappFab: {
      label: "Message us on WhatsApp",
    },
    heroSearch: {
      operationAll: "Buy or rent",
      operationBuy: "Buy",
      operationRent: "Rent",
      placeholder: "Where do you want to live? Area, neighborhood or city",
      submit: "Search",
    },
    filterBar: {
      operation: "Operation",
      type: "Property type",
      typeShort: "Type",
      zone: "Area",
      priceMax: "Max price",
      priceMaxShort: "Max price",
      rooms: "Min. bedrooms",
      roomsShort: "Bedrooms",
      roomsPlus: "{n}+ bed",
      order: "Sort by",
      orderRecent: "Most recent",
      orderPriceAsc: "Lowest price",
      orderPriceDesc: "Highest price",
      orderAreaDesc: "Largest area",
      clearAll: "Clear all",
      updating: "Updating results…",
      upToPrice: "Up to {price}",
    },
    leadForm: {
      name: "Name",
      namePlaceholder: "What's your name?",
      phone: "Mobile (WhatsApp)",
      operation: "What do you want to do",
      operationBuy: "Buy",
      operationRent: "Rent",
      operationSell: "Sell my property",
      zone: "Area of interest (optional)",
      zonePlaceholder: "Envigado, Sabaneta…",
      budget: "Approximate budget (optional)",
      budgetPlaceholder: "E.g.: between 300 and 500 million",
      honeypot: "Leave this field empty",
      sending: "Sending…",
      submit: "Continue on WhatsApp",
      disclaimer: "By submitting you agree to be contacted via WhatsApp. Your data is never shared with third parties.",
      successTitle: "Done! Opening WhatsApp for you…",
      successBody: "If it doesn't open automatically, message us directly and we'll help you right away.",
      errorBody: "We couldn't send your details. Try again or message us directly on WhatsApp.",
    },
    emptyState: {
      notFoundTitle: "This page doesn't exist (or the property is no longer available)",
      notFoundDescription:
        "The property may have been sold or rented. Our inventory changes daily — check what's available or tell us what you're looking for.",
      noResultsTitle: "We couldn't find properties with those filters",
      noResultsDescription:
        "Try widening the area or budget. You can also tell us what you're looking for and we'll let you know when it's available.",
      viewAll: "View all properties",
      tellUs: "Tell us what you're looking for",
    },
    propertyGallery: {
      expandMain: "Expand main photo",
      photosCount: "{n} photos",
      expandN: "Expand photo {n}",
      galleryOf: "Gallery of {title}",
      close: "Close gallery",
      prev: "Previous photo",
      next: "Next photo",
    },
    catalogPage: {
      countOne: "{n} property",
      countOther: "{n} properties",
      noResults: "No results with these filters",
    },
    footer: {
      explore: "Explore",
      forSale: "For sale",
      forRent: "For rent",
      contact: "Contact",
      rights: "All rights reserved.",
    },
    propertySpecs: {
      sqm: "{n} square meters",
      rooms: "{n} bedrooms",
      baths: "{n} bathrooms",
      parking: "{n} parking spots",
    },
    home: {
      step: "Step {n}:",
    },
    sellPageUi: {
      eyebrow: "For property owners",
      whatsappCta: "Tell us about your property",
      how: "How it works",
      valuationTitle: "Let's start with a no-obligation valuation",
      valuationBody:
        "Leave us your details and an advisor will contact you to learn about your property and give you a real market estimate. No hidden costs, no forced exclusivity.",
    },
    pagination: {
      nav: "Pagination",
      prev: "Previous page",
      next: "Next page",
    },
    propertyPage: {
      newBadge: "New",
      ref: "Ref.",
      perMonth: "/ month",
      admin: "HOA fee:",
      estrato: "Stratum",
      about: "About this property",
      whyLove: "Why you'll love it",
      features: "Features",
      viewOriginal: "View original listing",
      similar: "Similar properties",
      interested: "Interested in this property?",
      talkToTeam: "Talk to our team now",
      wantToSee: "I want to see it — WhatsApp",
      wantToSeeShort: "I want to see it",
      immediateResponse: "Immediate response · Ref. {ref} pre-filled",
      preferContact: "I'd rather be contacted →",
      backToProperties: "Back to properties",
    },
  },
} as const;

export type Language = keyof typeof dictionary;

type Dictionary = (typeof dictionary)["es"];

// Claves punteadas ("nav.home", "propertyPage.ref") derivadas del diccionario,
// para que useLanguage().t() solo acepte claves que realmente existen.
type DotPaths<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends Record<string, unknown>
    ? DotPaths<T[K], `${Prefix}${K}.`>
    : `${Prefix}${K}`;
}[keyof T & string];

export type TranslationKey = DotPaths<Dictionary>;

function getByPath(obj: unknown, path: string): string {
  const value = path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in acc) return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
  return typeof value === "string" ? value : path;
}

/** Sustituye placeholders {clave} por los valores de `vars`. */
export function translate(language: Language, key: TranslationKey, vars?: Record<string, string | number>): string {
  const raw = getByPath(dictionary[language], key);
  if (!vars) return raw;
  return Object.entries(vars).reduce((text, [k, v]) => text.replaceAll(`{${k}}`, String(v)), raw);
}

/**
 * Texto de la CONFIG DEL TENANT que puede venir en un solo idioma (string,
 * retrocompatible) o bilingüe ({ es, en }). Cubre el copy de marketing que no
 * vive en el diccionario de UI: secciones de la home, catálogo, página de
 * vender, tagline. Ver LocalizedString en config/tenant-schema.ts.
 */
export type LocalizedText = string | { es: string; en: string };

/** Resuelve un LocalizedText al idioma activo (fallback: español). */
export function localizeText(value: LocalizedText | null | undefined, language: Language): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return value[language] ?? value.es;
}
