import type { SectionOfType } from "@/config/tenant-schema";
import { Container } from "@/components/layout/container";
import { AnimatedCounter } from "@/components/shared/animated-counter";
import { getProperties } from "@/services/properties";

/**
 * Valor en vivo para metricas con `source` (hoy: conteo de propiedades
 * disponibles). El valor de la config queda como respaldo si la consulta
 * falla — la trust bar nunca debe tumbar la home.
 */
async function resolveMetricValue(metric: SectionOfType<"trust-bar">["metrics"][number]): Promise<number> {
  if (metric.source === "properties_count") {
    try {
      const properties = await getProperties();
      if (properties.length > 0) return properties.length;
    } catch {
      // cae al valor de la config
    }
  }
  return metric.value;
}

/** Prueba social con numeros (patron Stripe), justo despues de la promesa del hero. */
export async function TrustBarSection({ section }: { section: SectionOfType<"trust-bar"> }) {
  const values = await Promise.all(section.metrics.map(resolveMetricValue));
  return (
    <section className="border-b border-line">
      <Container>
        <dl className="grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {section.metrics.map((metric, i) => (
            <div key={metric.label} className="flex flex-col items-center gap-1 py-8 text-center sm:py-10">
              <dt className="order-2 text-sm text-muted">{metric.label}</dt>
              <dd className="order-1 font-heading text-4xl tracking-tight md:text-5xl">
                <AnimatedCounter value={values[i] ?? metric.value} prefix={metric.prefix} suffix={metric.suffix} />
              </dd>
            </div>
          ))}
        </dl>
      </Container>
    </section>
  );
}
