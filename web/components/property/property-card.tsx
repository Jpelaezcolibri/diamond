import Link from "next/link";
import type { Property } from "@/types/property";
import { Badge } from "@/components/design-system/badge";
import { PropertyImage } from "./property-image";
import { PropertySpecs } from "./property-specs";
import { cn } from "@/lib/utils";
import { isNewProperty } from "@/lib/property-freshness";

interface PropertyCardProps {
  property: Property;
  /** Prioriza la carga de imagen (cards above the fold). */
  priority?: boolean;
  sizes?: string;
  className?: string;
}

/**
 * Card editorial estilo Compass: fotografia protagonista 3:2, tipografia
 * minima, hover con zoom sutil de imagen. Toda la card es un solo link.
 */
export function PropertyCard({
  property,
  priority = false,
  sizes = "(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw",
  className,
}: PropertyCardProps) {
  return (
    <article className={cn("group", className)}>
      <Link
        href={`/propiedades/${property.slug}`}
        className="block focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
      >
        <div className="relative aspect-[3/2] overflow-hidden rounded-brand-lg bg-surface">
          <PropertyImage
            property={property}
            sizes={sizes}
            priority={priority}
            className="transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
          <div className="absolute left-3 top-3 flex gap-2">
            <Badge>{property.operacion}</Badge>
            {isNewProperty(property.createdAt) && <Badge variant="accent">Nuevo</Badge>}
          </div>
        </div>

        <div className="pt-4">
          <p className="font-heading text-xl tracking-tight tabular-nums">{property.precio.formatted}</p>
          <p className="mt-1 line-clamp-1 text-sm text-foreground/80">
            {property.tipo}
            {property.zona ? ` · ${property.zona}` : ""}
          </p>
          <PropertySpecs property={property} className="mt-2" />
        </div>
      </Link>
    </article>
  );
}
