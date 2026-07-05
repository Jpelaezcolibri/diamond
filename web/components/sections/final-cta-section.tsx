import { MessageCircle } from "lucide-react";
import { getTenantConfig } from "@/config/tenant";
import { generalWhatsAppUrl } from "@/lib/whatsapp";
import type { SectionOfType } from "@/config/tenant-schema";
import { SectionShell } from "@/components/layout/section-shell";
import { Button } from "@/components/design-system/button";
import { FadeIn } from "@/components/animations/fade-in";
import { LeadForm } from "@/components/forms/lead-form";

/** Cierre de la home (Peak-End): formulario corto o CTA directo a WhatsApp. */
export function FinalCtaSection({ section }: { section: SectionOfType<"final-cta"> }) {
  const config = getTenantConfig();

  return (
    <SectionShell id="contacto" className="border-t border-line bg-surface/60">
      <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-2">
        <FadeIn>
          <h2 className="max-w-md text-3xl leading-tight md:text-4xl">{section.title}</h2>
          {section.subtitle ? (
            <p className="mt-4 max-w-md text-base leading-relaxed text-muted md:text-lg">{section.subtitle}</p>
          ) : null}
          <Button asChild variant="whatsapp" size="lg" className="mt-8">
            <a href={generalWhatsAppUrl(config)} target="_blank" rel="noopener noreferrer">
              <MessageCircle aria-hidden="true" />
              Hablemos por WhatsApp
            </a>
          </Button>
        </FadeIn>

        {section.showForm ? (
          <FadeIn delay={0.1}>
            <LeadForm context="home" />
          </FadeIn>
        ) : null}
      </div>
    </SectionShell>
  );
}
