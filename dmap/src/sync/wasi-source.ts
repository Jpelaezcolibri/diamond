import { z } from "zod";

/** Forma normalizada de una propiedad, sin importar la fuente Wasi que la produjo. */
export const canonicalPropertySchema = z.object({
  ref: z.string(),
  titulo: z.string().nullable(),
  tipo: z.string().nullable().default(null),
  operacion: z.enum(["Venta", "Arriendo"]).nullable(),
  precio: z.string().nullable(),
  descripcion: z.string().nullable().default(null),
  area: z.string().nullable().default(null),
  habitaciones: z.number().int().nullable().default(null),
  banos: z.number().int().nullable().default(null),
  // Garaje y estrato (2026-09-02). Faltaban desde el principio: el sync los
  // escribia como null al crear y no los volvia a mirar, asi que llenarlos en
  // Wasi no llegaba a la base. Medido ese dia: garaje cargado en 29% del
  // inventario y estrato en 32%, y los que si estaban venian del import de
  // Excel viejo, no de Wasi. El radar puntua por lo que puede VERIFICAR, asi
  // que un apartamento con garaje sin cargar pierde contra otro del que
  // sabemos menos.
  garaje: z.number().int().nullable().default(null),
  estrato: z.number().int().nullable().default(null),
  // Caracteristicas (2026-09-05). La API oficial manda `features.internal` y
  // `features.external` ("Urbanizacion cerrada", "Terraza", "Balcon", "Vista
  // panoramica", "Garaje"...) para 43 de 112 propiedades y el sync no las
  // guardaba: para el radar eran datos que "no registramos" aunque Wasi los
  // tuviera. Texto plano separado por ", ", que es lo que properties.
  // caracteristicas ya guardaba del import viejo. null si la fuente no trae.
  caracteristicas: z.string().nullable().default(null),
  zona: z.string().nullable().default(null),
  ciudad: z.string().nullable().default(null),
  link: z.string().nullable().default(null),
  imageKeys: z.array(z.string()).default([]),
  imageUrls: z.array(z.string()).default([])
});

export type CanonicalProperty = z.infer<typeof canonicalPropertySchema>;

/**
 * Resultado de intentar sincronizar una propiedad puntual. `gone` indica que
 * la fuente ya no la tiene (404/410 en Wasi, o ausente del listado de la API)
 * — se marca no disponible y se cierra con un evento `removed`, no un diff.
 */
export interface SyncCandidate {
  /** id en la tabla `properties` de este monorepo; null si la fuente propone una propiedad nueva. */
  propertyId: string | null;
  wasiId: string | null;
  gone: boolean;
  data: CanonicalProperty | null;
}

export interface WasiSource {
  readonly kind: "wasi_api" | "wasi_public";
  fetchCandidates(orgId: string): Promise<SyncCandidate[]>;
}
