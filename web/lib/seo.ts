import type { TenantConfig } from "@/config/tenant-schema";
import type { Property } from "@/types/property";

/** JSON-LD de la organizacion (home). */
export function organizationJsonLd(config: TenantConfig): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "RealEstateAgent",
    name: config.brand.name,
    description: config.seo.description,
    url: config.seo.baseUrl,
    areaServed: config.brand.city,
    address: { "@type": "PostalAddress", addressCountry: "CO", addressLocality: config.brand.city },
    ...(config.brand.logo ? { logo: new URL(config.brand.logo.light, config.seo.baseUrl).toString() } : {}),
  };
}

/** JSON-LD de una propiedad (detalle). */
export function propertyJsonLd(config: TenantConfig, property: Property): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    name: property.titulo,
    url: `${config.seo.baseUrl}/propiedades/${property.slug}`,
    // ImageObject (no solo URLs planas): es la forma que Google documenta
    // para elegibilidad de rich results con imagen destacada.
    ...(property.images.length
      ? { image: property.images.map((url) => ({ "@type": "ImageObject", url })) }
      : {}),
    ...(property.descripcion ? { description: property.descripcion } : {}),
    datePosted: property.createdAt,
    offers: {
      "@type": "Offer",
      ...(property.precio.amount ? { price: property.precio.amount, priceCurrency: "COP" } : {}),
      // Siempre InStock es correcto aquí: esta función solo se llama con
      // propiedades `disponible=true` (getPropertyByRef filtra las demás,
      // y el sync de Wasi marca disponible=false ante 404/410 → dejan de
      // resolver del todo, nunca quedan con metadata stale). InStock no
      // implica "en venta" — describe que la oferta sigue abierta;
      // `businessFunction` ya distingue Venta (Sell) de Arriendo (LeaseOut).
      availability: "https://schema.org/InStock",
      businessFunction:
        property.operacion === "Venta" ? "http://purl.org/goodrelations/v1#Sell" : "http://purl.org/goodrelations/v1#LeaseOut",
      offeredBy: { "@type": "RealEstateAgent", name: config.brand.name },
    },
    ...(property.zona || property.ciudad
      ? {
          address: {
            "@type": "PostalAddress",
            addressCountry: "CO",
            ...(property.ciudad ? { addressRegion: property.ciudad } : {}),
            ...(property.zona ? { addressLocality: property.zona } : {}),
          },
        }
      : {}),
    ...(property.area.m2
      ? { floorSize: { "@type": "QuantitativeValue", value: property.area.m2, unitCode: "MTK" } }
      : {}),
    ...(property.habitaciones ? { numberOfRooms: property.habitaciones } : {}),
  };
}
