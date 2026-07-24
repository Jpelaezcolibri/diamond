import { Quote } from "lucide-react";
import type { SectionOfType } from "@/config/tenant-schema";
import { SectionShell } from "@/components/layout/section-shell";
import { SectionHeading } from "@/components/shared/section-heading";
import { Stagger } from "@/components/animations/fade-in";
import { LT } from "@/components/shared/lt";

/** Testimonios con nombre y resultado concreto — social proof antes del cierre. */
export function TestimonialsSection({ section }: { section: SectionOfType<"testimonials"> }) {
  return (
    <SectionShell>
      <SectionHeading eyebrow={section.eyebrow ? <LT v={section.eyebrow} /> : undefined} title={<LT v={section.title} />} align="center" />
      <Stagger className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {section.items.map((item) => (
          <figure key={item.name} className="rounded-brand-lg border border-line bg-surface p-7">
            <Quote className="size-5 text-accent" aria-hidden="true" />
            <blockquote className="mt-4 text-sm leading-relaxed text-foreground/90">
              “<LT v={item.quote} />”
            </blockquote>
            <figcaption className="mt-5">
              <p className="text-sm font-semibold">{item.name}</p>
              {item.result ? <p className="mt-0.5 text-xs text-accent-strong"><LT v={item.result} /></p> : null}
              {item.role ? <p className="mt-0.5 text-xs text-muted"><LT v={item.role} /></p> : null}
            </figcaption>
          </figure>
        ))}
      </Stagger>
    </SectionShell>
  );
}
