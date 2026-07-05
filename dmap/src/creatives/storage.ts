import { getSupabase } from "../repositories/supabase.js";

export const CREATIVES_BUCKET = "dmap-creatives";

export interface UploadedCreative {
  storagePath: string;
  publicUrl: string;
}

/**
 * Sube un creative renderizado al bucket publico dmap-creatives (Meta
 * exige URLs publicamente descargables para publicar — ver
 * dmap/ARCHITECTURE.md #4/#14). Path: {org_id}/{publication_id}/{role}-{position}.jpg
 */
export async function uploadCreative(
  orgId: string,
  publicationId: string,
  role: string,
  position: number,
  buffer: Buffer
): Promise<UploadedCreative> {
  const path = `${orgId}/${publicationId}/${role}-${position}.jpg`;
  const supabase = getSupabase();

  const { error } = await supabase.storage.from(CREATIVES_BUCKET).upload(path, buffer, {
    contentType: "image/jpeg",
    upsert: true
  });
  if (error) throw new Error(`uploadCreative: ${error.message}`);

  const { data } = supabase.storage.from(CREATIVES_BUCKET).getPublicUrl(path);
  return { storagePath: path, publicUrl: data.publicUrl };
}
