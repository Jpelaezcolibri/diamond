"use client";

import * as React from "react";
import {
  useQueryStates,
  parseAsString,
  parseAsInteger,
  parseAsStringLiteral,
} from "nuqs";
import { X, SlidersHorizontal, LoaderCircle } from "lucide-react";
import { NativeSelect, Input } from "@/components/design-system/input";
import { Button } from "@/components/design-system/button";
import { formatPriceShort } from "@/lib/price";
import { cn } from "@/lib/utils";

// Techos de precio segun operacion (COP). Max 5 controles visibles (Hick's Law).
const VENTA_CAPS = [300_000_000, 500_000_000, 800_000_000, 1_200_000_000, 2_000_000_000, 4_000_000_000];
const ARRIENDO_CAPS = [1_500_000, 2_000_000, 3_000_000, 5_000_000, 8_000_000];

const ORDEN = ["reciente", "precio-asc", "precio-desc", "area-desc"] as const;

interface FilterBarProps {
  zonas: string[];
  tipos: string[];
  operaciones: string[];
}

/**
 * Filtros del catalogo, URL-driven via nuqs: cada estado es una URL
 * compartible server-rendered; back/forward del navegador funciona.
 */
export function FilterBar({ zonas, tipos, operaciones }: FilterBarProps) {
  // shallow:false hace que cada cambio dispare un round-trip al RSC (fetch de
  // Supabase incluido); sin useTransition el usuario no tenía ninguna señal
  // de que el clic "hizo algo" mientras esa respuesta llega.
  const [isPending, startTransition] = React.useTransition();

  const [filters, setFilters] = useQueryStates(
    {
      operacion: parseAsStringLiteral(["Venta", "Arriendo"] as const),
      tipo: parseAsString,
      zona: parseAsString,
      q: parseAsString,
      precioMax: parseAsInteger,
      habitaciones: parseAsInteger,
      orden: parseAsStringLiteral(ORDEN).withDefault("reciente"),
      pagina: parseAsInteger,
    },
    { shallow: false, history: "replace", startTransition }
  );

  const caps = filters.operacion === "Arriendo" ? ARRIENDO_CAPS : VENTA_CAPS;

  // Cualquier cambio de filtro vuelve a la pagina 1.
  function update(patch: Partial<typeof filters>) {
    void setFilters({ ...patch, pagina: null });
  }

  const active: { label: string; clear: () => void }[] = [];
  if (filters.operacion) active.push({ label: filters.operacion, clear: () => update({ operacion: null, precioMax: null }) });
  if (filters.tipo) active.push({ label: filters.tipo, clear: () => update({ tipo: null }) });
  if (filters.zona) active.push({ label: filters.zona, clear: () => update({ zona: null }) });
  if (filters.q) active.push({ label: `"${filters.q}"`, clear: () => update({ q: null }) });
  if (filters.precioMax) active.push({ label: `Hasta ${formatPriceShort(filters.precioMax)}`, clear: () => update({ precioMax: null }) });
  if (filters.habitaciones) active.push({ label: `${filters.habitaciones}+ hab`, clear: () => update({ habitaciones: null }) });

  return (
    <div className="sticky top-16 z-30 -mx-5 border-b border-line bg-background/90 px-5 py-3 backdrop-blur-md sm:-mx-8 sm:px-8 md:top-20">
      <div
        aria-busy={isPending}
        className={cn(
          "mx-auto flex max-w-6xl flex-wrap items-center gap-2 transition-opacity duration-200",
          isPending && "pointer-events-none opacity-60"
        )}
      >
        {isPending ? (
          <LoaderCircle className="size-4 animate-spin text-muted" aria-hidden="true" />
        ) : (
          <SlidersHorizontal className="hidden size-4 text-muted sm:block" aria-hidden="true" />
        )}

        <NativeSelect
          aria-label="Operación"
          value={filters.operacion ?? ""}
          onChange={(e) => update({ operacion: (e.target.value || null) as "Venta" | "Arriendo" | null, precioMax: null })}
          className="h-10 w-auto min-w-32 text-sm"
        >
          <option value="">Comprar o arrendar</option>
          {operaciones.includes("Venta") ? <option value="Venta">Comprar</option> : null}
          {operaciones.includes("Arriendo") ? <option value="Arriendo">Arrendar</option> : null}
        </NativeSelect>

        <NativeSelect
          aria-label="Tipo de inmueble"
          value={filters.tipo ?? ""}
          onChange={(e) => update({ tipo: e.target.value || null })}
          className="h-10 w-auto min-w-28 text-sm"
        >
          <option value="">Tipo</option>
          {tipos.map((tipo) => (
            <option key={tipo} value={tipo}>
              {tipo}
            </option>
          ))}
        </NativeSelect>

        <NativeSelect
          aria-label="Zona"
          value={filters.zona ?? ""}
          onChange={(e) => update({ zona: e.target.value || null })}
          className="h-10 w-auto min-w-28 max-w-48 text-sm"
        >
          <option value="">Zona</option>
          {zonas.map((zona) => (
            <option key={zona} value={zona}>
              {zona}
            </option>
          ))}
        </NativeSelect>

        <NativeSelect
          aria-label="Precio máximo"
          value={filters.precioMax ?? ""}
          onChange={(e) => update({ precioMax: e.target.value ? Number(e.target.value) : null })}
          className="h-10 w-auto min-w-28 text-sm"
        >
          <option value="">Precio máx.</option>
          {caps.map((cap) => (
            <option key={cap} value={cap}>
              {formatPriceShort(cap)}
            </option>
          ))}
        </NativeSelect>

        <NativeSelect
          aria-label="Habitaciones mínimas"
          value={filters.habitaciones ?? ""}
          onChange={(e) => update({ habitaciones: e.target.value ? Number(e.target.value) : null })}
          className="h-10 w-auto min-w-24 text-sm"
        >
          <option value="">Habitaciones</option>
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n}+
            </option>
          ))}
        </NativeSelect>

        <div className="ml-auto flex items-center gap-2">
          <label htmlFor="orden" className="hidden text-xs text-muted lg:block">
            Ordenar
          </label>
          <NativeSelect
            id="orden"
            aria-label="Ordenar por"
            value={filters.orden}
            onChange={(e) => void setFilters({ orden: e.target.value as (typeof ORDEN)[number], pagina: null })}
            className="h-10 w-auto text-sm"
          >
            <option value="reciente">Más recientes</option>
            <option value="precio-asc">Menor precio</option>
            <option value="precio-desc">Mayor precio</option>
            <option value="area-desc">Mayor área</option>
          </NativeSelect>
        </div>
      </div>

      <p role="status" className="sr-only">
        {isPending ? "Actualizando resultados…" : ""}
      </p>

      {active.length ? (
        <div className="mx-auto mt-2 flex max-w-6xl flex-wrap items-center gap-2">
          {active.map((chip) => (
            <button
              key={chip.label}
              onClick={chip.clear}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-3 py-1 text-xs text-foreground/80 hover:border-foreground/30"
            >
              {chip.label}
              <X className="size-3" aria-hidden="true" />
              <span className="sr-only">Quitar filtro {chip.label}</span>
            </button>
          ))}
          <Button
            variant="link"
            size="sm"
            className="text-xs text-muted"
            onClick={() =>
              void setFilters({
                operacion: null, tipo: null, zona: null, q: null,
                precioMax: null, habitaciones: null, pagina: null,
              })
            }
          >
            Limpiar todo
          </Button>
        </div>
      ) : null}
    </div>
  );
}
