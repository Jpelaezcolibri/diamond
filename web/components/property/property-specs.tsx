import { BedDouble, Bath, Car, Ruler } from "lucide-react";
import type { Property } from "@/types/property";
import { cn } from "@/lib/utils";

interface PropertySpecsProps {
  property: Property;
  className?: string;
  /** "row" para cards (compacto) · "detail" para la ficha (con garaje). */
  variant?: "row" | "detail";
}

/** Specs en una linea: área · habitaciones · baños (· garaje). */
export function PropertySpecs({ property, className, variant = "row" }: PropertySpecsProps) {
  const items = [
    property.area.m2 ? { icon: Ruler, label: `${property.area.m2} m²`, sr: `${property.area.m2} metros cuadrados` } : null,
    property.habitaciones ? { icon: BedDouble, label: String(property.habitaciones), sr: `${property.habitaciones} habitaciones` } : null,
    property.banos ? { icon: Bath, label: String(property.banos), sr: `${property.banos} baños` } : null,
    variant === "detail" && property.garaje ? { icon: Car, label: String(property.garaje), sr: `${property.garaje} parqueaderos` } : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  if (!items.length) return null;

  return (
    <ul className={cn("flex items-center gap-4 text-sm text-muted", className)}>
      {items.map((item, i) => (
        <li key={i} className="flex items-center gap-1.5">
          <item.icon className="size-4" strokeWidth={1.5} aria-hidden="true" />
          <span aria-hidden="true" className="tabular-nums">{item.label}</span>
          <span className="sr-only">{item.sr}</span>
        </li>
      ))}
    </ul>
  );
}
