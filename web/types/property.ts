export type Operacion = "Venta" | "Arriendo";

/** Propiedad normalizada para la UI. Nunca usar PropertyRow fuera de la capa de datos. */
export interface Property {
  id: string;
  ref: string;
  /** Slug SEO derivado: slugify(titulo)-ref. */
  slug: string;
  titulo: string;
  tipo: string;
  operacion: Operacion;
  precio: {
    /** Texto original de la BD (ej "$800.000.000"). */
    raw: string;
    /** Valor numerico en COP para filtros/orden; null si no parseable. */
    amount: number | null;
    /** Formateado es-CO para mostrar. */
    formatted: string;
  };
  area: { raw: string | null; m2: number | null };
  habitaciones: number | null;
  banos: number | null;
  garaje: number | null;
  estrato: number | null;
  administracion: string | null;
  zona: string | null;
  ciudad: string | null;
  descripcion: string | null;
  caracteristicas: string[];
  images: string[];
  wasiLink: string | null;
  disponible: boolean;
  createdAt: string;
}
