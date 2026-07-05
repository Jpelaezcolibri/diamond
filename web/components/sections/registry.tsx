import type { ComponentType } from "react";
import type { SectionConfig, SectionType } from "@/config/tenant-schema";
import { HeroSection } from "./hero-section";
import { FeaturedPropertiesSection } from "./featured-properties-section";
import { TrustBarSection } from "./trust-bar-section";
import { WhyUsSection } from "./why-us-section";
import { HowItWorksSection } from "./how-it-works-section";
import { SellCtaSection } from "./sell-cta-section";
import { TestimonialsSection } from "./testimonials-section";
import { FinalCtaSection } from "./final-cta-section";

// ---------------------------------------------------------------------------
// Section registry: el unico mapeo type → componente. La home es un loop
// sobre config.home.sections — orden, on/off y contenido viven en la config.
// Anadir una seccion v2 (mapa, asistente) = un type en el schema + una linea aqui.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SECTION_COMPONENTS: Record<SectionType, ComponentType<{ section: any }>> = {
  hero: HeroSection,
  "trust-bar": TrustBarSection,
  "featured-properties": FeaturedPropertiesSection,
  "why-us": WhyUsSection,
  "how-it-works": HowItWorksSection,
  "sell-cta": SellCtaSection,
  testimonials: TestimonialsSection,
  "final-cta": FinalCtaSection,
};

export function RenderSections({ sections }: { sections: SectionConfig[] }) {
  return (
    <>
      {sections
        .filter((section) => section.enabled)
        .map((section) => {
          const Section = SECTION_COMPONENTS[section.type];
          return <Section key={section.id} section={section} />;
        })}
    </>
  );
}
