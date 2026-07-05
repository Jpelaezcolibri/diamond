import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MessageCircle, Camera, Megaphone, Filter, ShieldCheck } from "lucide-react";
import { getTenantConfig } from "@/config/tenant";
import { sellerWhatsAppUrl } from "@/lib/whatsapp";
import { Container } from "@/components/layout/container";
import { SectionShell } from "@/components/layout/section-shell";
import { Button } from "@/components/design-system/button";
import { LeadForm } from "@/components/forms/lead-form";
import { FadeIn, Stagger } from "@/components/animations/fade-in";

const BENEFIT_ICONS = [Camera, Megaphone, Filter, ShieldCheck];

export function generateMetadata(): Metadata {
  const config = getTenantConfig();
  return {
    title: config.sellPage.title,
    description: config.sellPage.subtitle ?? config.seo.description,
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
              Para propietarios
            </p>
            <h1 className="text-4xl leading-tight md:text-5xl">{sellPage.title}</h1>
            {sellPage.subtitle ? (
              <p className="mt-5 text-base leading-relaxed text-muted md:text-lg">{sellPage.subtitle}</p>
            ) : null}
            <Button asChild variant="whatsapp" size="lg" className="mt-8">
              <a href={sellerWhatsAppUrl(config)} target="_blank" rel="noopener noreferrer">
                <MessageCircle aria-hidden="true" />
                Cuéntanos de tu propiedad
              </a>
            </Button>
          </div>
        </Container>
      </div>

      <SectionShell>
        <Stagger className="grid grid-cols-1 gap-x-12 gap-y-10 md:grid-cols-3">
          {sellPage.benefits.map((benefit, i) => {
            const Icon = BENEFIT_ICONS[i % BENEFIT_ICONS.length];
            return (
              <div key={benefit.title}>
                <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-full border border-accent/40">
                  <Icon className="size-5 text-accent" strokeWidth={1.5} aria-hidden="true" />
                </div>
                <h2 className="font-body text-lg font-semibold tracking-tight">{benefit.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">{benefit.description}</p>
              </div>
            );
          })}
        </Stagger>
      </SectionShell>

      <SectionShell className="border-y border-line bg-surface/60">
        <h2 className="mb-12 max-w-xl text-3xl leading-tight md:mb-16 md:text-4xl">Así funciona</h2>
        <Stagger className="grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {sellPage.steps.map((step, index) => (
            <div key={step.title}>
              <p className="font-heading text-5xl text-accent/50 tabular-nums" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </p>
              <h3 className="mt-4 font-body text-base font-semibold tracking-tight">
                <span className="sr-only">Paso {index + 1}: </span>
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{step.description}</p>
            </div>
          ))}
        </Stagger>
      </SectionShell>

      <SectionShell>
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-2">
          <FadeIn>
            <h2 className="max-w-md text-3xl leading-tight md:text-4xl">
              Empecemos con una valoración sin compromiso
            </h2>
            <p className="mt-4 max-w-md text-base leading-relaxed text-muted">
              Déjanos tus datos y un asesor te contacta para conocer tu propiedad y darte un
              estimado real de mercado. Sin costos ocultos, sin exclusividades forzadas.
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
