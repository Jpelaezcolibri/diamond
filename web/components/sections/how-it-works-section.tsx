import type { SectionOfType } from "@/config/tenant-schema";
import { SectionShell } from "@/components/layout/section-shell";
import { SectionHeading } from "@/components/shared/section-heading";
import { Stagger } from "@/components/animations/fade-in";
import { LT } from "@/components/shared/lt";
import { T } from "@/components/shared/t";

/** Proceso en pasos numerados: reduce la friccion del "¿y ahora que?". */
export function HowItWorksSection({ section }: { section: SectionOfType<"how-it-works"> }) {
  return (
    <SectionShell className="border-y border-line bg-surface/60">
      <SectionHeading eyebrow={section.eyebrow ? <LT v={section.eyebrow} /> : undefined} title={<LT v={section.title} />} />
      <Stagger className="grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
        {section.steps.map((step, index) => (
          <div key={index} className="relative">
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
  );
}
