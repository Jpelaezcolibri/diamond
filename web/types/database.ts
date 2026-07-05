/** Fila cruda de la tabla `properties` en Supabase (ver db/schema.sql). */
export interface PropertyRow {
  id: string;
  org_id: string;
  ref: string;
  titulo: string;
  tipo: string | null;
  operacion: string | null;
  precio: string | null;
  area: string | null;
  habitaciones: number | null;
  banos: number | null;
  garaje: number | null;
  estrato: number | null;
  administracion: string | null;
  zona: string | null;
  ciudad: string | null;
  descripcion: string | null;
  caracteristicas: string | null;
  link: string | null;
  disponible: boolean;
  images: string[] | null;
  created_at: string;
}
