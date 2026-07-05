import { env } from "../config/env.js";
import { FatalError } from "../lib/errors.js";
import type { StyleVariant } from "../config/constants.js";
import { analyzeImages, selectAssets } from "../ai/image-selector.js";
import { generateCopy } from "../ai/copywriter.js";
import type { CopywriterPropertyInput } from "../ai/prompts/copywriter.v1.js";
import { resolveBrandProfile, type BrandProfile } from "../creatives/brand.js";
import { renderCreative, type CreativeInput } from "../creatives/renderer.js";
import { uploadCreative } from "../creatives/storage.js";
import { getPropertyById, type PropertyRow } from "../repositories/properties.repo.js";
import { createPublication } from "../repositories/publications.repo.js";
import { createPublicationAssets, type CreateAssetInput } from "../repositories/publication-assets.repo.js";
import { recordPublicationEvent } from "../repositories/publication-events.repo.js";
import { recordContentGeneration } from "../repositories/content-generations.repo.js";

export interface GenerateDraftResult {
  publicationId: string;
}

/** PropertyRow -> insumo del copywriter — separado para poder testearlo sin red. */
export function buildPropertyCopyInput(property: PropertyRow): CopywriterPropertyInput {
  return {
    ref: property.ref,
    titulo: property.titulo,
    operacion: property.operacion,
    precio: property.precio,
    area: property.area,
    habitaciones: property.habitaciones,
    banos: property.banos,
    zona: property.zona,
    ciudad: property.ciudad,
    descripcion: property.descripcion,
    caracteristicas: property.caracteristicas
  };
}

/** Datos comunes a todos los tamanos de creative para esta propiedad — separado para poder testearlo sin red. */
export function buildCreativeBaseData(property: PropertyRow, tituloComercial: string): Omit<CreativeInput, "sourceImageUrl"> {
  return {
    titulo: tituloComercial,
    precio: property.precio,
    operacion: property.operacion,
    zona: property.zona,
    ciudad: property.ciudad,
    ref: property.ref
  };
}

async function renderAndUpload(
  brand: BrandProfile,
  base: Omit<CreativeInput, "sourceImageUrl">,
  sourceImageUrl: string,
  sizeKey: Parameters<typeof renderCreative>[2],
  orgId: string,
  publicationId: string,
  role: CreateAssetInput["role"],
  altText: string
): Promise<CreateAssetInput> {
  const rendered = await renderCreative(brand, { ...base, sourceImageUrl }, sizeKey);
  const uploaded = await uploadCreative(orgId, publicationId, role, 0, rendered.buffer);
  return {
    publication_id: publicationId,
    role,
    position: 0,
    source_image_url: sourceImageUrl,
    storage_path: uploaded.storagePath,
    public_url: uploaded.publicUrl,
    width: rendered.width,
    height: rendered.height,
    format: rendered.format,
    alt_text: altText,
    selected_by: "ai"
  };
}

/**
 * Pipeline completo de generacion (ver dmap/ARCHITECTURE.md #6): selecciona
 * fotos -> genera copy -> renderiza creatives -> crea la publicacion en
 * `draft`. Nunca publica ni aprueba nada — eso pasa por publication.service
 * cuando un humano lo decide (Content Studio).
 */
export async function generateDraftForProperty(
  orgId: string,
  propertyId: string,
  styleVariant: StyleVariant,
  actor: string
): Promise<GenerateDraftResult> {
  const property = await getPropertyById(propertyId);
  if (!property) throw new FatalError(`Propiedad ${propertyId} no existe`);
  if (!property.images || property.images.length === 0) {
    throw new FatalError(`Propiedad ${property.ref} no tiene fotos sincronizadas`);
  }

  const brand = await resolveBrandProfile(orgId);

  const analyses = await analyzeImages(orgId, propertyId, property.images);
  const assets = selectAssets(analyses);
  if (!assets) {
    throw new FatalError(`Propiedad ${property.ref}: ninguna foto es utilizable (todas oscuras o invalidas)`);
  }

  const copyResult = await generateCopy(buildPropertyCopyInput(property), styleVariant, { name: brand.name });

  await recordContentGeneration({
    org_id: orgId,
    property_id: propertyId,
    kind: "copy",
    style_variant: styleVariant,
    model: env.CLAUDE_MODEL,
    prompt_version: copyResult.promptVersion,
    input: buildPropertyCopyInput(property),
    output: copyResult.output,
    tokens_in: copyResult.tokensIn,
    tokens_out: copyResult.tokensOut
  });

  const publication = await createPublication({
    org_id: orgId,
    property_id: propertyId,
    kind: "single_image",
    style_variant: styleVariant,
    copy_facebook: copyResult.output.copy_facebook,
    copy_instagram: copyResult.output.copy_instagram,
    titulo_comercial: copyResult.output.titulo_comercial,
    descripcion_comercial: copyResult.output.descripcion_comercial,
    meta_title: copyResult.output.meta_title,
    meta_description: copyResult.output.meta_description,
    hashtags: copyResult.output.hashtags,
    cta: copyResult.output.cta,
    ...(brand.id ? { brand_profile_id: brand.id } : {}),
    created_by: actor
  });

  const creativeBase = buildCreativeBaseData(property, copyResult.output.titulo_comercial);
  const altText = copyResult.output.alt_text_cover;

  const coverAsset = await renderAndUpload(brand, creativeBase, assets.cover, "ig_feed", orgId, publication.id, "cover", altText);
  const storyAsset = await renderAndUpload(brand, creativeBase, assets.story, "ig_story", orgId, publication.id, "story", altText);
  const thumbnailAsset: CreateAssetInput = { ...coverAsset, role: "thumbnail" };

  await createPublicationAssets([coverAsset, storyAsset, thumbnailAsset]);

  await recordPublicationEvent({
    publication_id: publication.id,
    org_id: orgId,
    from_status: null,
    to_status: "draft",
    actor,
    detail: { source: "generation.service", styleVariant, propertyRef: property.ref }
  });

  return { publicationId: publication.id };
}
