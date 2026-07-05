import { MessageCircle, BadgeCheck, Users, ShieldCheck, Sparkles, Clock } from "lucide-react";
import type { SectionOfType } from "@/config/tenant-schema";
import { SectionShell } from "@/components/layout/section-shell";
import { SectionHeading } from "@/components/shared/section-heading";
import { Stagger } from "@/components/animations/fade-in";

const ICONS: Record<string, typeof MessageCircle> = {
  "message-circle": MessageCircle,
  "badge-check": BadgeCheck,
  users: Users,
  "shield-check": ShieldCheck,
  sparkles: Sparkles,
  clock: Clock,
};

/** Diferenciales como beneficios (max 4 — Miller's Law). Sin cajas: editorial. */
export function WhyUsSection({ section }: { section: SectionOfType<"why-us"> }) {
  return (
    <SectionShell>
      <SectionHeading eyebrow={section.eyebrow} title={section.title} />
      <Stagger className="grid grid-cols-1 gap-x-12 gap-y-10 md:grid-cols-3">
        {section.items.map((item) => {
          const Icon = item.icon ? (ICONS[item.icon] ?? Sparkles) : Sparkles;
          return (
            <div key={item.title}>
              <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-full border border-accent/40">
                <Icon className="size-5 text-accent" strokeWidth={1.5} aria-hidden="true" />
              </div>
              <h3 className="font-body text-lg font-semibold tracking-tight">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{item.description}</p>
            </div>
          );
        })}
      </Stagger>
    </SectionShell>
  );
}
