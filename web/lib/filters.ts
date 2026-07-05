import { z } from "zod";
import type { Property } from "@/types/property";

// ---------------------------------------------------------------------------
// Filtros del catalogo. URL-driven: los searchParams son la unica fuente de
// verdad (URLs compartibles + server-rendered). Nunca se confia en la URL:
// todo pasa por FilterSchema.
// ---------------------------------------------------------------------------

export const FilterSchema = z.object({
  operacion: z.enum(["Venta", "Arriendo"]).optional().catch(undefined),
  tipo: z.string().max(40).optional().catch(undefined),
  zona: z.string().max(80).optional().catch(undefined),
  q: z.string().max(80).optional().catch(undefined),
  precioMin: z.coerce.number().int().positive().optional().catch(undefined),
  precioMax: z.coerce.number().int().positive().optional().catch(undefined),
  habitaciones: z.coerce.number().int().min(1).max(10).optional().catch(undefined),
  banos: z.coerce.number().int().min(1).max(10).optional().catch(undefined),
  orden: z.enum(["reciente", "precio-asc", "precio-desc", "area-desc"]).catch("reciente"),
  pagina: z.coerce.number().int().min(1).catch(1),
});

export type Filters = z.infer<typeof FilterSchema>;

type RawSearchParams = Record<string, string | string[] | undefined>;

export function parseFilters(searchParams: RawSearchParams): Filters {
  const flat: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(searchParams)) {
    flat[key] = Array.isArray(value) ? value[0] : value;
  }
  return FilterSchema.parse(flat);
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

export function applyFilters(properties: Property[], f: Filters): Property[] {
  let result = properties.filter((p) => {
    if (f.operacion && p.operacion !== f.operacion) return false;
    if (f.tipo && normalize(p.tipo) !== normalize(f.tipo)) return false;
    if (f.zona && !(p.zona && normalize(p.zona).includes(normalize(f.zona)))) return false;
    if (f.q) {
      const haystack = normalize([p.titulo, p.zona, p.ciudad, p.tipo, p.ref].filter(Boolean).join(" "));
      if (!haystack.includes(normalize(f.q))) return false;
    }
    if (f.precioMin && (p.precio.amount === null || p.precio.amount < f.precioMin)) return false;
    if (f.precioMax && (p.precio.amount === null || p.precio.amount > f.precioMax)) return false;
    if (f.habitaciones && (p.habitaciones === null || p.habitaciones < f.habitaciones)) return false;
    if (f.banos && (p.banos === null || p.banos < f.banos)) return false;
    return true;
  });

  switch (f.orden) {
    case "precio-asc":
      result = [...result].sort((a, b) => (a.precio.amount ?? Infinity) - (b.precio.amount ?? Infinity));
      break;
    case "precio-desc":
      result = [...result].sort((a, b) => (b.precio.amount ?? -1) - (a.precio.amount ?? -1));
      break;
    case "area-desc":
      result = [...result].sort((a, b) => (b.area.m2 ?? -1) - (a.area.m2 ?? -1));
      break;
    default:
      // "reciente": orden natural (created_at desc desde la query)
      break;
  }

  return result;
}

export function paginate<T>(items: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, totalPages);
  return {
    items: items.slice((current - 1) * pageSize, current * pageSize),
    total: items.length,
    totalPages,
    current,
  };
}

/** Cuenta filtros activos (para el chip "Filtros · n" en mobile). */
export function countActiveFilters(f: Filters): number {
  return [f.operacion, f.tipo, f.zona, f.q, f.precioMin, f.precioMax, f.habitaciones, f.banos].filter(
    (v) => v !== undefined
  ).length;
}
