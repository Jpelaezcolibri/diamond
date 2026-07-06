import { env } from "../config/env.js";
import { FatalError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { COST_PER_GPT_IMAGE_USD, GPT_IMAGE_QUALITY, GPT_IMAGE_SIZES, type GptImageSizeKey, type StyleVariant } from "../config/constants.js";
import { analyzeImages, selectAssets } from "../ai/image-selector.js";
import { generateCopy, type CopywriterOutput } from "../ai/copywriter.js";
import type { CopywriterPropertyInput } from "../ai/prompts/copywriter.v1.js";
import { isGptImageConfigured } from "../ai/gpt-image.js";
import { resolveBrandProfile, type BrandProfile } from "../creatives/brand.js";
import { renderCreative, type CreativeInput } from "../creatives/renderer.js";
import { generateAiCreative } from "../creatives/ai-engine.js";
import { uploadCreative } from "../creatives/storage.js";
import { getPropertyById, type PropertyRow } from "../repositories/properties.repo.js";
import { createPublication, getPublicationById, updatePublicationContent } from "../repositories/publications.repo.js";
import { createPublicationAssets, type CreateAssetInput } from "../repositories/publication-assets.repo.js";
import { recordPublicationEvent } from "../repositories/publication-events.repo.js";
import { recordContentGeneration } from "../repositories/content-generations.repo.js";
import { markChangeEventsProcessedForProperty } from "../repositories/sync.repo.js";
import { getOrgMarketingSettings } from "../repositories/settings.repo.js";
import type { CreativeEngine } from "../repositories/types.js";

export interface GenerateDraftResult {
  publicationId: string;
}

/**
 * `actor` trae el prefijo de auditoria ("user:<uuid>" | "system:<worker>",
 * ver publication_events.actor) pero `publications.created_by` es un uuid
 * real — pasarle el string con prefijo rompe con "invalid input syntax for
 * type uuid" (bug real 2026-07-06, primer intento de "Publicar" desde el
 * CRM). Solo se guarda el uuid cuando el actor es un usuario; para
 * system:* queda null (no hay usuario que referenciar).
 */
export function actorUserId(actor: string): string | null {
  const match = /^user:(.+)$/.exec(actor);
  return match?.[1] ?? null;
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
 * Motor de creativos efectivo para la org: "ai" solo si esta configurado el
 * Director de Arte (OPENAI_API_KEY) — sin el, degrada a template en silencio
 * (log info) para no bloquear la generacion. `creative_engine` puede venir
 * undefined si la migracion 2026-07-06 aun no corrio: default "ai".
 */
export async function resolveCreativeEngine(orgId: string): Promise<CreativeEngine> {
  if (!isGptImageConfigured()) {
    logger.info({ orgId }, "OPENAI_API_KEY no configurada — motor de creativos: template");
    return "template";
  }
  const settings = await getOrgMarketingSettings(orgId);
  return settings.creative_engine === "template" ? "template" : "ai";
}

/** Resumen por asset para el detail del evento draft (visible en el Content Studio). */
interface CreativeMeta {
  engine: "ai" | "template" | "template_fallback";
  score?: number;
  approved?: boolean;
  rounds?: number;
  reason?: string;
  /** Problemas de la ultima ronda del critico — solo cuando NO aprobo, para
   *  mostrarlos en el aviso "Revisar creativo" (content_generations esta
   *  cerrada a lectura del CRM por RLS, asi que viajan en el evento). */
  problemas?: string[];
}

interface ProducedAsset {
  asset: CreateAssetInput;
  meta: CreativeMeta;
}

/**
 * Deps inyectables para testear la integracion (seleccion de motor,
 * fallback por asset) sin red — los defaults usan los agentes/IO reales.
 */
export interface ProduceAssetDeps {
  aiCreative?: typeof generateAiCreative;
  renderTemplate?: typeof renderAndUpload;
  upload?: typeof uploadCreative;
  recordGeneration?: typeof recordContentGeneration;
}

export async function produceAsset(
  engine: CreativeEngine,
  brand: BrandProfile,
  property: PropertyRow,
  copy: CopywriterOutput,
  styleVariant: StyleVariant,
  sourceImageUrl: string,
  sizeKey: GptImageSizeKey,
  orgId: string,
  publicationId: string,
  role: CreateAssetInput["role"],
  deps: ProduceAssetDeps = {}
): Promise<ProducedAsset> {
  const creativeBase = buildCreativeBaseData(property, copy.titulo_comercial);
  const altText = copy.alt_text_cover;
  const renderTemplate = deps.renderTemplate ?? renderAndUpload;
  const upload = deps.upload ?? uploadCreative;
  const recordGeneration = deps.recordGeneration ?? recordContentGeneration;
  let fallbackReason: string | null = null;

  if (engine === "ai") {
    try {
      const aiCreative = deps.aiCreative ?? generateAiCreative;
      const format = sizeKey === "ig_story" ? ("story" as const) : ("feed" as const);
      const ai = await aiCreative(
        brand,
        {
          property: buildPropertyCopyInput(property),
          styleVariant,
          tituloComercial: copy.titulo_comercial,
          cta: copy.cta,
          format,
          brand: { name: brand.name }
        },
        sourceImageUrl,
        sizeKey
      );

      const uploaded = await upload(orgId, publicationId, role, 0, ai.buffer);

      // El registro es observabilidad: si falla (ej. la migracion del CHECK
      // de kind aun no corrio) NO se descarta el creative ya generado y
      // pagado — se loguea y se sigue.
      try {
        await recordGeneration({
          org_id: orgId,
          property_id: property.id,
          publication_id: publicationId,
          kind: "image_generation",
          style_variant: styleVariant,
          model: env.GPT_IMAGE_MODEL,
          prompt_version: ai.promptVersion,
          input: { role, sizeKey, gptSize: GPT_IMAGE_SIZES[sizeKey], quality: GPT_IMAGE_QUALITY, sourceImageUrl, masterPrompt: ai.masterPrompt, headline: ai.headline, rationale: ai.rationale },
          output: {
            approved: ai.approved,
            finalScore: ai.finalScore,
            roundsUsed: ai.rounds.length,
            rounds: ai.rounds,
            logoApplied: ai.logoApplied,
            storagePath: uploaded.storagePath,
            estimatedCostUsd: Number((ai.rounds.length * COST_PER_GPT_IMAGE_USD).toFixed(2))
          },
          tokens_in: ai.tokensIn,
          tokens_out: ai.tokensOut
        });
      } catch (err) {
        logger.warn({ err, publicationId, role }, "No se pudo registrar la generacion IA en content_generations");
      }

      return {
        asset: {
          publication_id: publicationId,
          role,
          position: 0,
          source_image_url: sourceImageUrl,
          storage_path: uploaded.storagePath,
          public_url: uploaded.publicUrl,
          width: ai.width,
          height: ai.height,
          format: ai.format,
          alt_text: altText,
          selected_by: "ai"
        },
        meta: {
          engine: "ai",
          score: ai.finalScore,
          approved: ai.approved,
          rounds: ai.rounds.length,
          ...(ai.approved ? {} : { problemas: ai.rounds[ai.rounds.length - 1]?.problemas.slice(0, 6) ?? [] })
        }
      };
    } catch (err) {
      fallbackReason = (err as Error).message;
      logger.warn({ err, role, publicationId }, "Motor IA de creativos fallo — fallback a plantilla");
    }
  }

  const asset = await renderTemplate(brand, creativeBase, sourceImageUrl, sizeKey, orgId, publicationId, role, altText);
  return {
    asset,
    meta: fallbackReason ? { engine: "template_fallback", reason: fallbackReason.slice(0, 300) } : { engine: "template" }
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
    created_by: actorUserId(actor)
  });

  // Cover y story EN PARALELO: con el motor IA cada rol puede tomar 1-2 min
  // (GPT Image + critico x hasta 2 rondas) — en serie duplicaria la espera
  // del boton "Publicar" del CRM.
  const engine = await resolveCreativeEngine(orgId);
  const [cover, story] = await Promise.all([
    produceAsset(engine, brand, property, copyResult.output, styleVariant, assets.cover, "ig_feed", orgId, publication.id, "cover"),
    produceAsset(engine, brand, property, copyResult.output, styleVariant, assets.story, "ig_story", orgId, publication.id, "story")
  ]);
  const thumbnailAsset: CreateAssetInput = { ...cover.asset, role: "thumbnail" };

  await createPublicationAssets([cover.asset, story.asset, thumbnailAsset]);

  await recordPublicationEvent({
    publication_id: publication.id,
    org_id: orgId,
    from_status: null,
    to_status: "draft",
    actor,
    detail: {
      source: "generation.service",
      styleVariant,
      propertyRef: property.ref,
      creative: {
        engine,
        cover: cover.meta,
        story: story.meta,
        // El critico IA no aprobo alguna pieza: el Content Studio muestra
        // el aviso "Revisar creativo" — la decision final es humana.
        needsReview: cover.meta.approved === false || story.meta.approved === false
      }
    }
  });

  await markChangeEventsProcessedForProperty(orgId, propertyId);

  return { publicationId: publication.id };
}

/**
 * "Regenerar en estilo X" desde el Content Studio: vuelve a generar SOLO el
 * copy (mantiene los creatives/fotos ya renderizados) — un texto nuevo no
 * suele requerir cambiar la foto elegida. Solo valido mientras la
 * publicacion sigue en 'draft'.
 */
export async function regenerateCopyForPublication(publicationId: string, styleVariant: StyleVariant): Promise<void> {
  const publication = await getPublicationById(publicationId);
  if (!publication) throw new FatalError(`Publicacion ${publicationId} no existe`);
  if (publication.status !== "draft") {
    throw new FatalError(`Solo se puede regenerar una publicacion en 'draft' (esta en '${publication.status}')`);
  }
  if (!publication.property_id) throw new FatalError(`Publicacion ${publicationId} no tiene propiedad asociada`);

  const property = await getPropertyById(publication.property_id);
  if (!property) throw new FatalError(`Propiedad ${publication.property_id} no existe`);

  const brand = await resolveBrandProfile(publication.org_id);
  const copyResult = await generateCopy(buildPropertyCopyInput(property), styleVariant, { name: brand.name });

  await recordContentGeneration({
    org_id: publication.org_id,
    property_id: property.id,
    publication_id: publicationId,
    kind: "copy",
    style_variant: styleVariant,
    model: env.CLAUDE_MODEL,
    prompt_version: copyResult.promptVersion,
    input: buildPropertyCopyInput(property),
    output: copyResult.output,
    tokens_in: copyResult.tokensIn,
    tokens_out: copyResult.tokensOut
  });

  await updatePublicationContent(publicationId, {
    style_variant: styleVariant,
    copy_facebook: copyResult.output.copy_facebook,
    copy_instagram: copyResult.output.copy_instagram,
    titulo_comercial: copyResult.output.titulo_comercial,
    descripcion_comercial: copyResult.output.descripcion_comercial,
    meta_title: copyResult.output.meta_title,
    meta_description: copyResult.output.meta_description,
    hashtags: copyResult.output.hashtags,
    cta: copyResult.output.cta
  });
}
