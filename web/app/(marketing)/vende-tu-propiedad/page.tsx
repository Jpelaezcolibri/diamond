import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MessageCircle, Camera, Megaphone, Filter, ShieldCheck } from "lucide-react";
import { getTenantConfig } from "@/config/tenant";
import { WaLink } from "@/components/shared/wa-link";
import { Container } from "@/components/layout/container";
import { SectionShell } from "@/components/layout/section-shell";
import { Button } from "@/components/design-system/button";
import { LeadForm } from "@/components/forms/lead-form";
import { FadeIn, Stagger } from "@/components/animations/fade-in";
import { LT } from "@/components/shared/lt";
import { T } from "@/components/shared/t";
import { localizeText } from "@/config/i18n";

const BENEFIT_ICONS = [Camera, Megaphone, Filter, ShieldCheck];

export function generateMetadata(): Metadata {
  const config = getTenantConfig();
  return {
    // Metadata SEO: siempre en español (decision de la spec del toggle).
    title: localizeText(config.sellPage.title, "es"),
    description: config.sellPage.subtitle ? localizeText(config.sellPage.subtitle, "es") : config.seo.description,
    alternates: { canonical: "/vende-tu-propiedad" },
  };
}

/** Captacion de propietarios: promesa clara + proceso + formulario. */
export default function SellPage() {
  const config = getTenantConfig();
  if (!config.sellPage.enabled) notFound();
  const { sellPage } = config;

  return (
    <main>
      {/* Banda invertida: audiencia distinta, atmosfera distinta */}
      <div className="dark bg-background text-foreground">
        <Container className="py-section-sm md:py-section">
          <div className="max-w-2xl">
            <p className="mb-4 text-xs font-medium uppercase tracking-[0.25em] text-accent">
              <T k="sellPageUi.eyebrow" />
            </p>
            <h1 className="text-4xl leading-tight md:text-5xl"><LT v={sellPage.title} /></h1>
            {sellPage.subtitle ? (
              <p className="mt-5 text-base leading-relaxed text-muted md:text-lg"><LT v={sellPage.subtitle} /></p>
            ) : null}
            <Button asChild variant="whatsapp" size="lg" className="mt-8">
              <WaLink number={config.contact.whatsapp.number} message={config.contact.whatsapp.sellerMessage}>
                <MessageCircle aria-hidden="true" />
                <T k="sellPageUi.whatsappCta" />
              </WaLink>
            </Button>
          </div>
        </Container>
      </div>

      <SectionShell>
        <Stagger className="grid grid-cols-1 gap-x-12 gap-y-10 md:grid-cols-3">
          {sellPage.benefits.map((benefit, i) => {
            const Icon = BENEFIT_ICONS[i % BENEFIT_ICONS.length];
            return (
              <div key={i}>
                <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-full border border-accent/40">
                  <Icon className="size-5 text-accent" strokeWidth={1.5} aria-hidden="true" />
                </div>
                <h2 className="font-body text-lg font-semibold tracking-tight"><LT v={benefit.title} /></h2>
                <p className="mt-2 text-sm leading-relaxed text-muted"><LT v={benefit.description} /></p>
              </div>
            );
          })}
        </Stagger>
      </SectionShell>

      <SectionShell className="border-y border-line bg-surface/60">
        <h2 className="mb-12 max-w-xl text-3xl leading-tight md:mb-16 md:text-4xl"><T k="sellPageUi.how" /></h2>
        <Stagger className="grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {sellPage.steps.map((step, index) => (
            <div key={index}>
              <p className="font-heading text-5xl text-accent/50 tabular-nums" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </p>
              <h3 className="mt-4 font-body text-base font-semibold tracking-tight">
                <span className="sr-only"><T k="home.step" vars={{ n: index + 1 }} /> </span>
                <LT v={step.title} />
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted"><LT v={step.description} /></p>
            </div>
          ))}
        </Stagger>
      </SectionShell>

      <SectionShell>
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-2">
          <FadeIn>
            <h2 className="max-w-md text-3xl leading-tight md:text-4xl">
              <T k="sellPageUi.valuationTitle" />
            </h2>
            <p className="mt-4 max-w-md text-base leading-relaxed text-muted">
              <T k="sellPageUi.valuationBody" />
            </p>
          </FadeIn>
          <FadeIn delay={0.1}>
            <LeadForm context="seller" />
          </FadeIn>
        </div>
      </SectionShell>
    </main>
  );
}
