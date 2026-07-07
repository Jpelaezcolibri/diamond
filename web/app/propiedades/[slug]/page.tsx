import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { MessageCircle, Check, ExternalLink } from "lucide-react";
import { getTenantConfig } from "@/config/tenant";
import { getProperties, getPropertyByRef, getSimilar } from "@/services/properties";
import { getPropertyContext } from "@/services/property-context";
import { refFromSlug } from "@/lib/slug";
import { propertyWhatsAppUrl } from "@/lib/whatsapp";
import { propertyJsonLd } from "@/lib/seo";
import { Container } from "@/components/layout/container";
import { Badge } from "@/components/design-system/badge";
import { Button } from "@/components/design-system/button";
import { JsonLd } from "@/components/shared/json-ld";
import { BackButton } from "@/components/navigation/back-button";
import { PropertyGallery } from "@/components/property/property-gallery";
import { PropertyImage } from "@/components/property/property-image";
import { PropertySpecs } from "@/components/property/property-specs";
import { PropertyCard } from "@/components/property/property-card";
import { LeadForm } from "@/components/forms/lead-form";

export const revalidate = 300;
export const dynamicParams = true;

export async function generateStaticParams() {
  const properties = await getProperties();
  return properties.map((p) => ({ slug: p.slug }));
}

type Params = { slug: string };

async function resolveProperty(slug: string) {
  const property = await getPropertyByRef(refFromSlug(slug));
  return property;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const property = await resolveProperty(slug);
  if (!property) return {};

  const location = [property.zona, property.ciudad].filter(Boolean).join(", ");
  const context = await getPropertyContext(property.ref);
  // El DCE ya redacta un titulo/descripcion pensados para SEO (ver
  // recommendations.seoTitle/seoDescription); si no existe, cae al calculo
  // generico de siempre.
  const title =
    context?.seoTitle ??
    `${property.tipo} en ${property.operacion.toLowerCase()}${location ? ` en ${location}` : ""} · ${property.precio.formatted}`;
  const description =
    context?.seoDescription ??
    property.descripcion?.slice(0, 155) ??
    `${property.tipo} en ${property.operacion.toLowerCase()} — Ref. ${property.ref}.`;

  return {
    title,
    description,
    alternates: { canonical: `/propiedades/${property.slug}` },
    openGraph: {
      title,
      description,
      locale: "es_CO",
      type: "website",
      // Sin width/height: las fotos vienen de un proxy Wasi con "fit:inside"
      // (ancho fijo 1600px, alto variable según cada foto) — declarar unas
      // dimensiones fijas sería incorrecto para unas y otras no.
      ...(property.images.length ? { images: [{ url: property.images[0], type: "image/jpeg" }] } : {}),
    },
  };
}

export default async function PropertyPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const config = getTenantConfig();
  const property = await resolveProperty(slug);
  if (!property) notFound();

  // Canonico: si el titulo cambio, el slug viejo redirige 301.
  if (slug !== property.slug) permanentRedirect(`/propiedades/${property.slug}`);

  const whatsappUrl = propertyWhatsAppUrl(config, property.ref);
  const similares = await getSimilar(property, 3);
  const location = [property.zona, property.ciudad].filter(Boolean).join(", ");
  const context = await getPropertyContext(property.ref);

  return (
    <main data-hide-fab>
      <JsonLd data={propertyJsonLd(config, property)} />

      <Container width="wide" className="pt-6 md:pt-10">
        <div className="mb-4">
          <BackButton fallbackHref="/propiedades" label="Volver a propiedades" />
        </div>
        <PropertyGallery
          property={property}
          placeholder={<PropertyImage property={property} sizes="100vw" priority />}
        />
      </Container>

      <Container className="pb-section-sm pt-8 md:pt-12">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1fr_380px]">
          {/* Columna editorial */}
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="accent">{property.operacion}</Badge>
              <span className="text-xs uppercase tracking-[0.18em] text-muted">Ref. {property.ref}</span>
            </div>

            {context?.heroMessage ? (
              <p className="mt-4 text-balance font-heading text-2xl leading-snug text-foreground md:text-3xl">
                {context.heroMessage}
              </p>
            ) : null}
            <h1
              className={
                context?.heroMessage
                  ? "mt-2 text-lg text-muted md:text-xl"
                  : "mt-4 text-3xl leading-tight md:text-4xl"
              }
            >
              {property.titulo}
            </h1>
            {context?.heroSubtitle ? <p className="mt-2 text-base text-muted">{context.heroSubtitle}</p> : null}
            {location ? (
              <p className={context?.heroSubtitle ? "mt-1 text-sm text-muted/80" : "mt-2 text-base text-muted"}>
                {location}
              </p>
            ) : null}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-y border-line py-5">
              <p className="font-heading text-3xl tracking-tight tabular-nums md:text-4xl">
                {property.precio.formatted}
                {property.operacion === "Arriendo" ? (
                  <span className="ml-1 text-base text-muted">/ mes</span>
                ) : null}
              </p>
              <PropertySpecs property={property} variant="detail" />
            </div>

            {property.administracion ? (
              <p className="mt-4 text-sm text-muted">
                Administración: <span className="text-foreground">{property.administracion}</span>
                {property.estrato ? (
                  <>
                    {" · "}Estrato <span className="text-foreground">{property.estrato}</span>
                  </>
                ) : null}
              </p>
            ) : null}

            {property.descripcion ? (
              <div className="mt-10">
                <h2 className="text-xl md:text-2xl">Sobre esta propiedad</h2>
                <p className="mt-4 max-w-prose whitespace-pre-line text-base leading-relaxed text-foreground/85">
                  {property.descripcion}
                </p>
              </div>
            ) : null}

            {context && context.benefits.length > 0 ? (
              <div className="mt-10">
                <h2 className="text-xl md:text-2xl">Por qué te va a encantar</h2>
                <ul className="mt-4 space-y-3">
                  {context.benefits.map((beneficio) => (
                    <li key={beneficio} className="flex items-start gap-2.5 text-base text-foreground/85">
                      <Check className="mt-1 size-4 shrink-0 text-accent" aria-hidden="true" />
                      {beneficio}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {property.caracteristicas.length ? (
              <div className="mt-10">
                <h2 className="text-xl md:text-2xl">Características</h2>
                <ul className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2.5 sm:grid-cols-2">
                  {property.caracteristicas.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-foreground/85">
                      <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {property.wasiLink ? (
              <p className="mt-10 text-sm">
                <a
                  href={property.wasiLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-muted underline-offset-4 hover:text-foreground hover:underline"
                >
                  Ver ficha original
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              </p>
            ) : null}
          </div>

          {/* Columna de conversion (sticky en desktop) */}
          <aside className="lg:sticky lg:top-28 lg:self-start">
            <div className="rounded-brand-lg border border-line bg-surface p-6 shadow-card">
              <p className="text-sm text-muted">¿Te interesa esta propiedad?</p>
              <p className="mt-1 font-heading text-lg">Habla ya con nuestro equipo</p>
              <Button asChild variant="whatsapp" size="lg" className="mt-5 w-full">
                <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                  <MessageCircle aria-hidden="true" />
                  Quiero verla — WhatsApp
                </a>
              </Button>
              <p className="mt-3 text-center text-xs text-muted">
                Respuesta inmediata · Ref. {property.ref} precargada
              </p>
            </div>

            <details className="group mt-4 rounded-brand-lg border border-line bg-surface p-6">
              <summary className="cursor-pointer text-sm font-medium marker:content-none">
                Prefiero que me contacten →
              </summary>
              <div className="mt-5">
                <LeadForm context="property" propertyRef={property.ref} className="border-0 p-0 shadow-none md:p-0" />
              </div>
            </details>
          </aside>
        </div>
      </Container>

      {similares.length ? (
        <section className="border-t border-line py-section-sm">
          <Container>
            <h2 className="text-2xl md:text-3xl">Propiedades similares</h2>
            <div className="mt-8 grid grid-cols-1 gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
              {similares.map((similar) => (
                <PropertyCard key={similar.ref} property={similar} />
              ))}
            </div>
          </Container>
        </section>
      ) : null}

      {/* Barra CTA fija en mobile: precio + WhatsApp siempre a un toque */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t border-line bg-background/95 px-5 py-3 backdrop-blur-md lg:hidden">
        <p className="font-heading text-lg tracking-tight tabular-nums">{property.precio.formatted}</p>
        <Button asChild variant="whatsapp" size="md">
          <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
            <MessageCircle aria-hidden="true" />
            Quiero verla
          </a>
        </Button>
      </div>
      <div className="h-16 lg:hidden" aria-hidden="true" />
    </main>
  );
}
