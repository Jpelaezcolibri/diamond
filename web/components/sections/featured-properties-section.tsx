import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getFeatured } from "@/services/properties";
import type { SectionOfType } from "@/config/tenant-schema";
import { SectionShell } from "@/components/layout/section-shell";
import { SectionHeading } from "@/components/shared/section-heading";
import { PropertyCard } from "@/components/property/property-card";
import { Button } from "@/components/design-system/button";
import { Stagger } from "@/components/animations/fade-in";

/** Curaduria de inventario: pocas cards, enormes, fotografia protagonista. */
export async function FeaturedPropertiesSection({
  section,
}: {
  section: SectionOfType<"featured-properties">;
}) {
  const properties = await getFeatured(section.count);
  if (!properties.length) return null;

  return (
    <SectionShell>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <SectionHeading
          eyebrow={section.eyebrow}
          title={section.title}
          subtitle={section.subtitle}
          className="mb-0 md:mb-0"
        />
        <Button asChild variant="link" className="mb-1">
          <Link href="/propiedades">
            Ver todas las propiedades
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>

      <Stagger className="mt-10 grid grid-cols-1 gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3 md:mt-14">
        {properties.map((property) => (
          <PropertyCard key={property.ref} property={property} />
        ))}
      </Stagger>
    </SectionShell>
  );
}
