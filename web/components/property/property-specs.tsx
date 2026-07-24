import { BedDouble, Bath, Car, Ruler } from "lucide-react";
import type { Property } from "@/types/property";
import type { TranslationKey } from "@/config/i18n";
import { T } from "@/components/shared/t";
import { cn } from "@/lib/utils";

interface PropertySpecsProps {
  property: Property;
  className?: string;
  /** "row" para cards (compacto) · "detail" para la ficha (con garaje). */
  variant?: "row" | "detail";
}

/** Specs en una linea: área · habitaciones · baños (· garaje). */
export function PropertySpecs({ property, className, variant = "row" }: PropertySpecsProps) {
  const items: { icon: typeof Ruler; label: string; srKey: TranslationKey; n: number }[] = [];
  if (property.area.m2) items.push({ icon: Ruler, label: `${property.area.m2} m²`, srKey: "propertySpecs.sqm", n: property.area.m2 });
  if (property.habitaciones) items.push({ icon: BedDouble, label: String(property.habitaciones), srKey: "propertySpecs.rooms", n: property.habitaciones });
  if (property.banos) items.push({ icon: Bath, label: String(property.banos), srKey: "propertySpecs.baths", n: property.banos });
  if (variant === "detail" && property.garaje) items.push({ icon: Car, label: String(property.garaje), srKey: "propertySpecs.parking", n: property.garaje });

  if (!items.length) return null;

  return (
    <ul className={cn("flex items-center gap-4 text-sm text-muted", className)}>
      {items.map((item, i) => (
        <li key={i} className="flex items-center gap-1.5">
          <item.icon className="size-4" strokeWidth={1.5} aria-hidden="true" />
          <span aria-hidden="true" className="tabular-nums">{item.label}</span>
          <span className="sr-only"><T k={item.srKey} vars={{ n: item.n }} /></span>
        </li>
      ))}
    </ul>
  );
}
