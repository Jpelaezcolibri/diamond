import type { PropertyRow } from "../../repositories/properties.repo.js";
import type { DerivedContext } from "../domain/property-context.js";

/**
 * Campos del Property Context que se derivan con codigo puro — nunca se le
 * pregunta a Claude lo que un `if` responde gratis. Se recalculan en cada
 * generacion sin costo.
 */

/**
 * Precio Wasi viene como texto colombiano (ej "$460.000.000", "1.550.000").
 * Los puntos son separador de miles; si hubiera coma decimal se descarta
 * (los precios inmobiliarios no usan centavos).
 */
export function parsePrecio(precio: string | null): number | null {
  if (!precio) return null;
  const cleaned = precio.replace(/[^\d.,]/g, "").split(",")[0] ?? "";
  const digits = cleaned.replace(/\./g, "");
  if (!/^\d+$/.test(digits)) return null;
  const value = Number(digits);
  return value > 0 ? value : null;
}

export function deriveCategoriaOperacion(operacion: string | null): DerivedContext["categoriaOperacion"] {
  const op = (operacion ?? "").toLowerCase();
  if (op.includes("venta")) return "venta";
  if (op.includes("arriendo") || op.includes("alquiler") || op.includes("renta")) return "arriendo";
  return "desconocida";
}

// Cortes en COP para el mercado del Valle de Aburra (jul 2026). Son
// deliberadamente gruesos: el segmento solo orienta tono/urgencia, la
// inferencia fina la hace Claude con el precio exacto a la vista.
const VENTA_CUTS: Array<[number, DerivedContext["segmentoPrecio"]]> = [
  [250_000_000, "economico"],
  [500_000_000, "medio"],
  [900_000_000, "medio-alto"],
  [1_800_000_000, "alto"]
];
const ARRIENDO_CUTS: Array<[number, DerivedContext["segmentoPrecio"]]> = [
  [1_500_000, "economico"],
  [3_000_000, "medio"],
  [5_500_000, "medio-alto"],
  [10_000_000, "alto"]
];

export function deriveSegmentoPrecio(
  precioNumerico: number | null,
  categoria: DerivedContext["categoriaOperacion"]
): DerivedContext["segmentoPrecio"] {
  if (precioNumerico === null || categoria === "desconocida") return "desconocido";
  const cuts = categoria === "venta" ? VENTA_CUTS : ARRIENDO_CUTS;
  for (const [limit, segmento] of cuts) {
    if (precioNumerico < limit) return segmento;
  }
  return "lujo";
}

export function deriveContext(property: PropertyRow): DerivedContext {
  const precioNumerico = parsePrecio(property.precio);
  const categoriaOperacion = deriveCategoriaOperacion(property.operacion);
  const caracteristicas = (property.caracteristicas ?? "")
    .split("\n")
    .map((c) => c.trim())
    .filter(Boolean);

  return {
    segmentoPrecio: deriveSegmentoPrecio(precioNumerico, categoriaOperacion),
    categoriaOperacion,
    precioNumerico,
    totalFotos: property.images?.length ?? 0,
    totalCaracteristicas: caracteristicas.length
  };
}
