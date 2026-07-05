import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { SectionOfType } from "@/config/tenant-schema";
import { SectionShell } from "@/components/layout/section-shell";
import { Button } from "@/components/design-system/button";
import { FadeIn } from "@/components/animations/fade-in";

/**
 * Banda invertida (ink) para el segundo publico: propietarios.
 * El contraste separa la audiencia vendedora del recorrido comprador.
 */
export function SellCtaSection({ section }: { section: SectionOfType<"sell-cta"> }) {
  return (
    <SectionShell inverted containerClassName="text-center">
      <FadeIn>
        {section.eyebrow ? (
          <p className="mb-4 text-xs font-medium uppercase tracking-[0.25em] text-accent-strong">{section.eyebrow}</p>
        ) : null}
        <h2 className="mx-auto max-w-2xl text-3xl leading-tight md:text-4xl">{section.title}</h2>
        {section.subtitle ? (
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted md:text-lg">
            {section.subtitle}
          </p>
        ) : null}
        <Button asChild size="lg" className="mt-8 h-auto min-h-13 whitespace-normal py-3 text-center">
          <Link href="/vende-tu-propiedad">
            {section.ctaLabel}
            <ArrowRight aria-hidden="true" className="hidden sm:inline" />
          </Link>
        </Button>
      </FadeIn>
    </SectionShell>
  );
}
