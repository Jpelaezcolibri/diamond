import { z } from "zod";

/** Forma normalizada de una propiedad, sin importar la fuente Wasi que la produjo. */
export const canonicalPropertySchema = z.object({
  ref: z.string(),
  titulo: z.string().nullable(),
  operacion: z.enum(["Venta", "Arriendo"]).nullable(),
  precio: z.string().nullable(),
  descripcion: z.string().nullable().default(null),
  area: z.string().nullable().default(null),
  habitaciones: z.number().int().nullable().default(null),
  banos: z.number().int().nullable().default(null),
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
