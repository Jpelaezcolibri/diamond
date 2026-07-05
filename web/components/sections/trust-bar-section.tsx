import type { SectionOfType } from "@/config/tenant-schema";
import { Container } from "@/components/layout/container";
import { AnimatedCounter } from "@/components/shared/animated-counter";

/** Prueba social con numeros (patron Stripe), justo despues de la promesa del hero. */
export function TrustBarSection({ section }: { section: SectionOfType<"trust-bar"> }) {
  return (
    <section className="border-b border-line">
      <Container>
        <dl className="grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {section.metrics.map((metric) => (
            <div key={metric.label} className="flex flex-col items-center gap-1 py-8 text-center sm:py-10">
              <dt className="order-2 text-sm text-muted">{metric.label}</dt>
              <dd className="order-1 font-heading text-4xl tracking-tight md:text-5xl">
                <AnimatedCounter value={metric.value} prefix={metric.prefix} suffix={metric.suffix} />
              </dd>
            </div>
          ))}
        </dl>
      </Container>
    </section>
  );
}
