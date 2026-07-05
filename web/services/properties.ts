import { unstable_cache } from "next/cache";
import { getTenantConfig } from "@/config/tenant";
import { getSupabase } from "@/lib/supabase";
import { mapProperty } from "@/lib/property-mapper";
import { demoProperties } from "./demo-data";
import type { PropertyRow } from "@/types/database";
import type { Property } from "@/types/property";

// ---------------------------------------------------------------------------
// Unica fuente de propiedades para toda la web. Una query cacheada (ISR 5min,
// tag "properties"); el resto deriva en memoria — con inventarios de cientos
// de propiedades esto es mas rapido y cacheable que una query por filtro.
// Sin Supabase → inventario demo (mismo shape, mismo mapper).
// ---------------------------------------------------------------------------

async function fetchAll(): Promise<Property[]> {
  const supabase = getSupabase();
  // El tenant demo siempre usa inventario de muestra, nunca datos reales.
  const isDemoTenant = getTenantConfig().id === "demo";

  let rows: PropertyRow[];
  if (!supabase || isDemoTenant) {
    rows = demoProperties;
  } else {
    // Columnas explícitas: nunca `select("*")`. Si mañana se añade una columna
    // interna (costo, comisión), no queda expuesta automáticamente por la RLS
    // pública de lectura anon.
    let query = supabase
      .from("properties")
      .select(
        "id, org_id, ref, titulo, tipo, operacion, precio, area, habitaciones, banos, garaje, estrato, administracion, zona, ciudad, descripcion, caracteristicas, link, disponible, images, created_at"
      )
      .eq("disponible", true)
      .order("created_at", { ascending: false });

    // Multi-tenant: filtra por org si esta configurada; con una sola org en
    // la BD puede omitirse (la RLS ya limita a disponibles).
    const orgId = process.env.TENANT_ORG_ID;
    if (orgId) query = query.eq("org_id", orgId);

    const { data, error } = await query;
    if (error) {
      // NO devolver [] aquí: unstable_cache cachearía el vacío 5 min y el
      // catálogo quedaría apagado tras un hipo transitorio de Supabase.
      // Lanzar propaga el error (Next no cachea excepciones) y lo captura
      // el error boundary, que reintenta en la siguiente request.
      console.error("[REF] Error consultando properties");
      throw new Error("No se pudo cargar el inventario");
    }
    rows = (data ?? []) as PropertyRow[];
  }

  return rows.filter((r) => r.disponible).map(mapProperty);
}

// La clave incluye tenant y org: dos deploys/tenants nunca comparten cache.
const getCached = unstable_cache(
  fetchAll,
  ["ref-properties", process.env.TENANT_ID ?? "diamond", process.env.TENANT_ORG_ID ?? "all"],
  { revalidate: 300, tags: ["properties"] }
);

/** Inventario completo del tenant (disponibles), normalizado y cacheado. */
export async function getProperties(): Promise<Property[]> {
  return getCached();
}

/** Busca por ref exacta (case-insensitive: el slug la trae en minusculas). */
export async function getPropertyByRef(ref: string): Promise<Property | null> {
  const all = await getProperties();
  const needle = ref.trim().toLowerCase();
  return all.find((p) => p.ref.toLowerCase() === needle) ?? null;
}

/** Seleccion para la home: las n con foto primero, luego las mas recientes. */
export async function getFeatured(n: number): Promise<Property[]> {
  const all = await getProperties();
  return [...all]
    .sort((a, b) => Number(b.images.length > 0) - Number(a.images.length > 0))
    .slice(0, n);
}

/** Propiedades de la misma operacion, priorizando la misma zona/ciudad. */
export async function getSimilar(property: Property, n = 3): Promise<Property[]> {
  const all = await getProperties();
  const candidates = all.filter((p) => p.ref !== property.ref && p.operacion === property.operacion);
  const sameZone = candidates.filter((p) => p.zona && p.zona === property.zona);
  const sameCity = candidates.filter((p) => !sameZone.includes(p) && p.ciudad && p.ciudad === property.ciudad);
  return [...sameZone, ...sameCity, ...candidates.filter((p) => !sameZone.includes(p) && !sameCity.includes(p))].slice(0, n);
}

export interface FilterOptions {
  zonas: string[];
  tipos: string[];
  operaciones: ("Venta" | "Arriendo")[];
  precio: { min: number; max: number } | null;
}

/** Opciones reales para los selects del buscador (derivadas del inventario). */
export async function getFilterOptions(): Promise<FilterOptions> {
  const all = await getProperties();
  const zonas = [...new Set(all.map((p) => p.zona).filter((z): z is string => !!z))].sort((a, b) =>
    a.localeCompare(b, "es")
  );
  const tipos = [...new Set(all.map((p) => p.tipo))].sort((a, b) => a.localeCompare(b, "es"));
  const operaciones = [...new Set(all.map((p) => p.operacion))] as ("Venta" | "Arriendo")[];
  const amounts = all.map((p) => p.precio.amount).filter((a): a is number => a !== null);
  return {
    zonas,
    tipos,
    operaciones,
    precio: amounts.length ? { min: Math.min(...amounts), max: Math.max(...amounts) } : null,
  };
}
