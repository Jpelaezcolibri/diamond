import Image from "next/image";
import { Building2, Home, Trees, Warehouse, LandPlot } from "lucide-react";
import { getTenantConfig } from "@/config/tenant";
import type { Property } from "@/types/property";
import { cn } from "@/lib/utils";

const TYPE_ICONS: Record<string, typeof Home> = {
  apartamento: Building2,
  apartaestudio: Building2,
  duplex: Building2,
  casa: Home,
  finca: Trees,
  lote: LandPlot,
  local: Warehouse,
};

function PlaceholderIcon({ tipo }: { tipo: string }) {
  const Icon = TYPE_ICONS[tipo.toLowerCase()] ?? Home;
  return <Icon className="size-8 text-accent" strokeWidth={1.25} aria-hidden="true" />;
}

interface PropertyImageProps {
  property: Property;
  /** Indice de la imagen a mostrar (default 0 = principal). */
  index?: number;
  sizes: string;
  priority?: boolean;
  className?: string;
}

/**
 * Imagen de propiedad con fallback editorial de marca: gradiente sobre
 * surface + monograma + icono por tipo. Nunca un gris con icono de casa roto.
 * Siempre dentro de un contenedor con aspect-ratio para no romper layout.
 */
export function PropertyImage({ property, index = 0, sizes, priority = false, className }: PropertyImageProps) {
  const config = getTenantConfig();
  const src = property.images[index];

  if (!src) {
    return (
      <div
        role="img"
        aria-label={`${property.tipo} en ${property.zona ?? property.ciudad ?? "ubicación reservada"} — fotografía próximamente`}
        className={cn(
          "flex h-full w-full flex-col items-center justify-center gap-3",
          "bg-[linear-gradient(160deg,var(--ref-surface),var(--ref-background))]",
          className
        )}
      >
        <span className="font-heading text-4xl text-foreground/15">{config.brand.monogram}</span>
        <PlaceholderIcon tipo={property.tipo} />
        <span className="text-[11px] uppercase tracking-[0.2em] text-muted">Ref. {property.ref}</span>
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={`${property.tipo} en ${property.operacion.toLowerCase()} — ${property.titulo}`}
      fill
      sizes={sizes}
      priority={priority}
      unoptimized
      className={cn("object-cover", className)}
    />
  );
}
