import type { PropertyRow } from "@/types/database";
import type { Property, Operacion } from "@/types/property";
import { parsePrice, formatPrice, parseArea } from "./price";
import { buildSlug } from "./slug";
import { htmlToPlainText } from "./clean-html";

function normalizeOperacion(raw: string | null): Operacion {
  return raw?.trim().toLowerCase() === "arriendo" ? "Arriendo" : "Venta";
}

function splitCaracteristicas(raw: string | null): string[] {
  // Puede venir con HTML/entidades igual que la descripcion — limpiar antes de partir.
  const clean = htmlToPlainText(raw);
  if (!clean) return [];
  return clean
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Normaliza la fila cruda de Supabase al shape que consume la UI. */
export function mapProperty(row: PropertyRow): Property {
  const amount = parsePrice(row.precio);
  return {
    id: row.id,
    ref: row.ref,
    slug: buildSlug(row.titulo, row.ref),
    titulo: row.titulo,
    tipo: row.tipo?.trim() || "Inmueble",
    operacion: normalizeOperacion(row.operacion),
    precio: {
      raw: row.precio ?? "",
      amount,
      formatted: amount ? formatPrice(amount) : (row.precio ?? "Precio a convenir"),
    },
    area: { raw: row.area, m2: parseArea(row.area) },
    habitaciones: row.habitaciones,
    banos: row.banos,
    garaje: row.garaje,
    estrato: row.estrato,
    administracion: row.administracion,
    zona: row.zona?.trim() || null,
    ciudad: row.ciudad?.trim() || null,
    descripcion: htmlToPlainText(row.descripcion),
    caracteristicas: splitCaracteristicas(row.caracteristicas),
    images: Array.isArray(row.images) ? row.images.filter(Boolean) : [],
    wasiLink: row.link,
    disponible: row.disponible,
    createdAt: row.created_at,
  };
}
