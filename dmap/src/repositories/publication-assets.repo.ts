import { getSupabase } from "./supabase.js";
import type { PublicationAssetRow } from "./types.js";

export type CreateAssetInput = Omit<PublicationAssetRow, "id">;

export async function createPublicationAssets(assets: CreateAssetInput[]): Promise<PublicationAssetRow[]> {
  if (assets.length === 0) return [];
  const { data, error } = await getSupabase().from("publication_assets").insert(assets).select();
  if (error) throw new Error(`createPublicationAssets: ${error.message}`);
  return (data as PublicationAssetRow[]) ?? [];
}

export async function listAssetsByPublication(publicationId: string): Promise<PublicationAssetRow[]> {
  const { data, error } = await getSupabase()
    .from("publication_assets")
    .select()
    .eq("publication_id", publicationId)
    .order("position", { ascending: true });
  if (error) throw new Error(`listAssetsByPublication: ${error.message}`);
  return (data as PublicationAssetRow[]) ?? [];
}

/**
 * Reemplaza la imagen de los assets del rol dado en position 0 (regenerar
 * creativo desde el Content Studio). Se pasan varios roles porque la portada
 * se reusa como thumbnail y como slide 0 del carrusel — apuntan al mismo
 * archivo, hay que actualizarlos juntos para que no queden desincronizados.
 */
export async function updateAssetsImageAtPosition0(
  publicationId: string,
  roles: PublicationAssetRow["role"][],
  fields: Pick<PublicationAssetRow, "storage_path" | "public_url" | "width" | "height" | "format">
): Promise<void> {
  const { error } = await getSupabase()
    .from("publication_assets")
    .update(fields)
    .eq("publication_id", publicationId)
    .in("role", roles)
    .eq("position", 0);
  if (error) throw new Error(`updateAssetsImageAtPosition0: ${error.message}`);
}

export async function reorderAssets(updates: Array<{ id: string; position: number; role?: PublicationAssetRow["role"] }>): Promise<void> {
  for (const u of updates) {
    const patch: Record<string, unknown> = { position: u.position };
    if (u.role) patch.role = u.role;
    const { error } = await getSupabase().from("publication_assets").update(patch).eq("id", u.id);
    if (error) throw new Error(`reorderAssets: ${error.message}`);
  }
}
