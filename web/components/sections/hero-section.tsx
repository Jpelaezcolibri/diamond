import Image from "next/image";
import Link from "next/link";
import { getTenantConfig } from "@/config/tenant";
import { getFilterOptions } from "@/services/properties";
import { generalWhatsAppUrl } from "@/lib/whatsapp";
import type { SectionOfType } from "@/config/tenant-schema";
import { Container } from "@/components/layout/container";
import { Button } from "@/components/design-system/button";
import { HeroSearch } from "@/components/search/hero-search";

/**
 * Hero cinematografico: una sola idea, foto protagonista a pantalla casi
 * completa, titular serif y el buscador como accion inmediata.
 */
export async function HeroSection({ section }: { section: SectionOfType<"hero"> }) {
  const config = getTenantConfig();
  const options = section.showSearch ? await getFilterOptions() : null;

  return (
    <section className="relative flex min-h-[88svh] items-end">
      <Image
        src={section.image}
        alt={section.imageAlt}
        fill
        priority
        sizes="100vw"
        className="object-cover"
      />
      {/* Overlay ink solo donde hay texto (regla de fotografia del DESIGN.md) */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(to_top,rgb(16_16_18/0.72)_0%,rgb(16_16_18/0.35)_45%,rgb(16_16_18/0.15)_100%)]"
      />

      <Container width="wide" className="relative pb-16 pt-40 md:pb-24">
        <div className="max-w-3xl text-white">
          {section.eyebrow ? (
            <p className="mb-4 text-xs font-medium uppercase tracking-[0.25em] text-white/80">
              {section.eyebrow}
            </p>
          ) : null}
          <h1 className="text-4xl leading-[1.08] md:text-6xl">{section.title}</h1>
          {section.subtitle ? (
            <p className="mt-5 max-w-xl text-base leading-relaxed text-white/85 md:text-lg">
              {section.subtitle}
            </p>
          ) : null}
        </div>

        <div className="mt-8 md:mt-10">
          {section.showSearch && options ? (
            <HeroSearch zonas={options.zonas} operaciones={options.operaciones} />
          ) : section.cta ? (
            <Button asChild size="lg" variant="primary">
              {section.cta.action === "whatsapp" ? (
                <a href={generalWhatsAppUrl(config)} target="_blank" rel="noopener noreferrer">
                  {section.cta.label}
                </a>
              ) : (
                <Link href={section.cta.action === "sell" ? "/vende-tu-propiedad" : "/propiedades"}>
                  {section.cta.label}
                </Link>
              )}
            </Button>
          ) : null}
        </div>
      </Container>
    </section>
  );
}
