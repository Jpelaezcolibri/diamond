import { env } from "../config/env.js";
import { FatalError } from "../lib/errors.js";
import { fetchImageBuffer } from "../lib/fetch-image.js";
import { logger } from "../lib/logger.js";
import {
  COST_PER_GEMINI_IMAGE_USD,
  COST_PER_GPT_IMAGE_USD,
  GPT_IMAGE_QUALITY,
  GPT_IMAGE_SIZES,
  type GptImageSizeKey,
  type StyleVariant
} from "../config/constants.js";
import { analyzeImages, rankImages, scoreImagesForBrief, selectAssets, type RoomType } from "../ai/image-selector.js";
import { generateCopy, type CopywriterOutput } from "../ai/copywriter.js";
import type { CopywriterPropertyInput } from "../ai/prompts/copywriter.v1.js";
import { isGptImageConfigured } from "../ai/gpt-image.js";
import { isGeminiImageConfigured } from "../ai/gemini-image.js";
import { resolveBrandProfile, type BrandProfile } from "../creatives/brand.js";
import { prepareCarouselPhoto } from "../creatives/compose.js";
import { renderCreative, type CreativeInput } from "../creatives/renderer.js";
import { generateAiCreative, type AiCreativeResult } from "../creatives/ai-engine.js";
import { generateDesignerCreative, type DesignerCreativeResult } from "../creatives/designer-engine.js";
import { uploadCreative } from "../creatives/storage.js";
import { getPropertyById, type PropertyRow } from "../repositories/properties.repo.js";
import { createPublication, getPublicationById, updatePublicationContent, updatePublicationKind } from "../repositories/publications.repo.js";
import { createPublicationAssets, listAssetsByPublication, updateAssetsImageAtPosition0, type CreateAssetInput } from "../repositories/publication-assets.repo.js";
import { recordPublicationEvent } from "../repositories/publication-events.repo.js";
import { recordContentGeneration } from "../repositories/content-generations.repo.js";
import { markChangeEventsProcessedForProperty } from "../repositories/sync.repo.js";
import { getOrgMarketingSettings } from "../repositories/settings.repo.js";
import type { CreativeEngine, PublicationAssetRow } from "../repositories/types.js";
import { getReadyContext } from "../cognitive/repositories/property-context.repo.js";
import { copywriterBriefFromContext, directorBriefFromContext } from "../cognitive/application/briefs.js";
import type { PropertyContext } from "../cognitive/domain/property-context.js";

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

/**
 * Property Context del DCE listo para consumir, o null. Null significa flujo
 * legacy identico al de siempre: el contexto ENRIQUECE la generacion pero
 * nunca la bloquea ni la tumba (ni siquiera si Supabase falla al leerlo).
 */
export async function loadCognitiveContext(orgId: string, propertyId: string): Promise<PropertyContext | null> {
  try {
    return await getReadyContext(orgId, propertyId);
  } catch (err) {
    logger.warn({ err, orgId, propertyId }, "DCE: no se pudo leer el Property Context — generacion sin contexto");
    return null;
  }
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
 * Motor de creativos efectivo para la org, degradando segun las keys
 * disponibles (nunca bloquea la generacion):
 *   - "ai" requiere OPENAI_API_KEY; sin ella degrada a template (historico).
 *   - "hybrid" requiere GEMINI_API_KEY; sin ella degrada a designer (la
 *     misma pieza, con la foto original sin retocar).
 *   - "designer" y "template" siempre disponibles.
 * `creative_engine` puede venir undefined si la migracion 2026-07-06 aun no
 * corrio: default "designer" (recomendado, costo $0 — igual que el default
 * de la columna desde la migracion 2026-07-09).
 */
export async function resolveCreativeEngine(orgId: string): Promise<CreativeEngine> {
  const settings = await getOrgMarketingSettings(orgId);
  const configured: CreativeEngine = settings.creative_engine ?? "designer";

  if (configured === "template" || configured === "designer") return configured;

  if (configured === "hybrid") {
    if (isGeminiImageConfigured()) return "hybrid";
    logger.info({ orgId }, "GEMINI_API_KEY no configurada — motor hibrido degrada a designer");
    return "designer";
  }

  if (!isGptImageConfigured()) {
    logger.info({ orgId }, "OPENAI_API_KEY no configurada — motor de creativos: template");
    return "template";
  }
  return "ai";
}

/** Resumen por asset para el detail del evento draft (visible en el Content Studio). */
interface CreativeMeta {
  engine: "ai" | "designer" | "hybrid" | "template" | "template_fallback";
  score?: number;
  approved?: boolean;
  rounds?: number;
  reason?: string;
  /** Problemas de la ultima ronda del critico — solo cuando NO aprobo, para
   *  mostrarlos en el aviso "Revisar creativo" (content_generations esta
   *  cerrada a lectura del CRM por RLS, asi que viajan en el evento). */
  problemas?: string[];
  /** Instrucciones de mejora de la ultima ronda del critico — solo cuando NO
   *  aprobo. El Content Studio las manda de vuelta a regenerate-creative con
   *  el boton "corregir con las recomendaciones del critico". */
  instrucciones?: string[];
}

/** Feedback accionable de la ultima ronda del critico (solo si no aprobo). */
function criticFeedbackMeta(ai: { approved: boolean; rounds: { problemas: string[]; instrucciones_de_mejora: string[] }[] }): Pick<CreativeMeta, "problemas" | "instrucciones"> {
  if (ai.approved) return {};
  const last = ai.rounds[ai.rounds.length - 1];
  return {
    problemas: last?.problemas.slice(0, 6) ?? [],
    instrucciones: last?.instrucciones_de_mejora.slice(0, 6) ?? []
  };
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
  designerCreative?: typeof generateDesignerCreative;
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
  deps: ProduceAssetDeps = {},
  /** Brief del DCE para director y critico — undefined = flujo legacy. */
  cognitiveBrief?: string
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
          brand: { name: brand.name },
          ...(cognitiveBrief ? { cognitiveBrief } : {})
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
          ...criticFeedbackMeta(ai)
        }
      };
    } catch (err) {
      fallbackReason = (err as Error).message;
      logger.warn({ err, role, publicationId }, "Motor IA de creativos fallo — fallback a plantilla");
    }
  }

  if (engine === "designer" || engine === "hybrid") {
    try {
      const designerCreative = deps.designerCreative ?? generateDesignerCreative;
      const format = sizeKey === "ig_story" ? ("story" as const) : ("feed" as const);
      const design = await designerCreative(
        brand,
        {
          property: buildPropertyCopyInput(property),
          styleVariant,
          tituloComercial: copy.titulo_comercial,
          cta: copy.cta,
          format,
          brand: { name: brand.name },
          ...(cognitiveBrief ? { cognitiveBrief } : {})
        },
        sourceImageUrl,
        sizeKey,
        engine
      );

      const uploaded = await upload(orgId, publicationId, role, 0, design.buffer);

      try {
        await recordGeneration({
          org_id: orgId,
          property_id: property.id,
          publication_id: publicationId,
          kind: "image_generation",
          style_variant: styleVariant,
          model: design.photoEnhanced ? "claude+gemini" : "claude",
          prompt_version: design.promptVersion,
          input: { role, sizeKey, engine, sourceImageUrl, designSpec: design.designSpec, headline: design.headline, rationale: design.rationale },
          output: {
            approved: design.approved,
            finalScore: design.finalScore,
            roundsUsed: design.rounds.length,
            rounds: design.rounds,
            logoApplied: design.logoApplied,
            photoEnhanced: design.photoEnhanced,
            storagePath: uploaded.storagePath,
            estimatedCostUsd: design.photoEnhanced ? Number(COST_PER_GEMINI_IMAGE_USD.toFixed(3)) : 0
          },
          tokens_in: design.tokensIn,
          tokens_out: design.tokensOut
        });
      } catch (err) {
        logger.warn({ err, publicationId, role }, "No se pudo registrar la generacion designer/hybrid en content_generations");
      }

      return {
        asset: {
          publication_id: publicationId,
          role,
          position: 0,
          source_image_url: sourceImageUrl,
          storage_path: uploaded.storagePath,
          public_url: uploaded.publicUrl,
          width: design.width,
          height: design.height,
          format: design.format,
          alt_text: altText,
          selected_by: "ai"
        },
        meta: {
          engine,
          score: design.finalScore,
          approved: design.approved,
          rounds: design.rounds.length,
          ...criticFeedbackMeta(design)
        }
      };
    } catch (err) {
      fallbackReason = (err as Error).message;
      logger.warn({ err, role, publicationId, engine }, "Motor designer/hybrid fallo — fallback a plantilla");
    }
  }

  const asset = await renderTemplate(brand, creativeBase, sourceImageUrl, sizeKey, orgId, publicationId, role, altText);
  return {
    asset,
    meta: fallbackReason ? { engine: "template_fallback", reason: fallbackReason.slice(0, 300) } : { engine: "template" }
  };
}

/** Deps inyectables para testear el armado del carrusel sin red. */
export interface CarouselDeps {
  fetchFn?: typeof fetch;
  prepare?: typeof prepareCarouselPhoto;
  upload?: typeof uploadCreative;
  /** Inyectable para tests: evita las esperas reales del backoff. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Slides del carrusel a partir de las fotos reales rankeadas (sin el cover:
 * el creative IA ya protagoniza esa foto y va de slide 1). Cada foto se
 * recorta a 1080x1080 y se sube al bucket (Meta exige URL publica; ademas
 * unifica el ratio de todos los hijos del carrusel). La descarga de Wasi se
 * reintenta (ver fetchImageBuffer) para no perder slides por un fallo
 * transitorio del CDN; si aun asi falla, ese slide se omite con warn — un
 * slide menos no debe tumbar la generacion completa.
 */
export async function produceCarouselSlides(
  orgId: string,
  publicationId: string,
  carouselPhotoUrls: string[],
  altText: string,
  deps: CarouselDeps = {}
): Promise<CreateAssetInput[]> {
  const fetchFn = deps.fetchFn ?? fetch;
  const prepare = deps.prepare ?? prepareCarouselPhoto;
  const upload = deps.upload ?? uploadCreative;

  const slides = await Promise.all(
    carouselPhotoUrls.map(async (url, i): Promise<CreateAssetInput | null> => {
      const position = i + 1; // position 0 es el cover creative
      try {
        const source = await fetchImageBuffer(url, { fetchFn, ...(deps.sleep ? { sleep: deps.sleep } : {}) });
        const rendered = await prepare(source);
        const uploaded = await upload(orgId, publicationId, "carousel", position, rendered.buffer);
        return {
          publication_id: publicationId,
          role: "carousel",
          position,
          source_image_url: url,
          storage_path: uploaded.storagePath,
          public_url: uploaded.publicUrl,
          width: rendered.width,
          height: rendered.height,
          format: rendered.format,
          alt_text: altText,
          selected_by: "ai"
        };
      } catch (err) {
        logger.warn({ err, url, publicationId, position }, "Slide de carrusel fallo — se publica sin este");
        return null;
      }
    })
  );

  return slides.filter((s): s is CreateAssetInput => s !== null);
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

  // DCE: si la propiedad ya tiene Property Context 'ready', copywriter,
  // director, critico Y AHORA TAMBIEN la seleccion de foto trabajan para el
  // buyer persona/direccion inferidos. Sin contexto (o si falla la lectura)
  // el flujo es el legacy, identico. En paralelo con analyzeImages: son
  // fuentes de datos independientes.
  const [analyses, cognitive] = await Promise.all([analyzeImages(orgId, propertyId, property.images), loadCognitiveContext(orgId, propertyId)]);
  const copyBrief = cognitive ? copywriterBriefFromContext(cognitive) : undefined;
  const creativeBrief = cognitive ? directorBriefFromContext(cognitive) : undefined;

  // Con brief cognitivo: reordena las mejores candidatas (ya filtradas por
  // calidad/tipo) segun que tanto sirven la direccion creativa — sin esto la
  // seleccion automatica es ciega a la estrategia y el critico rechaza
  // piezas que ninguna ronda de diseno puede arreglar (foto equivocada, no
  // layout equivocado; ver dmap/ARCHITECTURE.md #6). Sin brief, comportamiento
  // identico al de siempre.
  const briefFit = creativeBrief ? await scoreImagesForBrief(rankImages(analyses), creativeBrief) : undefined;
  const assets = selectAssets(analyses, briefFit);
  if (!assets) {
    throw new FatalError(`Propiedad ${property.ref}: ninguna foto es utilizable (todas oscuras o invalidas)`);
  }

  // Fotos reales para el carrusel, sin la del cover (el creative IA ya la
  // protagoniza como slide 1). Con al menos una foto extra la publicacion
  // sale en carrusel — el formato con mas engagement en FB/IG para
  // inmuebles (varias fotos = varios espacios); si la propiedad solo tiene
  // una foto utilizable, degrada a single_image como antes.
  const carouselPhotoUrls = assets.carousel.filter((url) => url !== assets.cover);
  const kind = carouselPhotoUrls.length > 0 ? ("carousel" as const) : ("single_image" as const);

  const copyResult = await generateCopy(buildPropertyCopyInput(property), styleVariant, { name: brand.name }, undefined, copyBrief);

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
    kind,
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

  // Cover, story y slides del carrusel EN PARALELO: con el motor IA cada
  // rol puede tomar 1-2 min (GPT Image + critico x hasta 2 rondas) — en
  // serie duplicaria la espera del boton "Publicar" del CRM. Los slides
  // solo son sharp + upload, no agregan latencia perceptible.
  const engine = await resolveCreativeEngine(orgId);
  const [cover, story, extraSlides] = await Promise.all([
    produceAsset(engine, brand, property, copyResult.output, styleVariant, assets.cover, "ig_feed", orgId, publication.id, "cover", {}, creativeBrief),
    produceAsset(engine, brand, property, copyResult.output, styleVariant, assets.story, "ig_story", orgId, publication.id, "story", {}, creativeBrief),
    produceCarouselSlides(orgId, publication.id, carouselPhotoUrls, copyResult.output.alt_text_cover)
  ]);
  const thumbnailAsset: CreateAssetInput = { ...cover.asset, role: "thumbnail" };
  // Slide 0 del carrusel = el cover creative (misma imagen, rol distinto):
  // el post arranca con la pieza disenada y sigue con las fotos limpias.
  const carouselAssets: CreateAssetInput[] =
    kind === "carousel" && extraSlides.length > 0 ? [{ ...cover.asset, role: "carousel", position: 0 }, ...extraSlides] : [];

  await createPublicationAssets([cover.asset, story.asset, thumbnailAsset, ...carouselAssets]);

  // Todas las fotos extra fallaron (descarga/upload): un carrusel de un solo
  // slide no es carrusel — volver la publicacion a single_image para que el
  // publisher use el cover como siempre.
  if (kind === "carousel" && extraSlides.length === 0) {
    await updatePublicationKind(publication.id, "single_image");
  }

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
      kind: carouselAssets.length > 0 ? "carousel" : "single_image",
      carouselSlides: carouselAssets.length,
      creative: {
        engine,
        cover: cover.meta,
        story: story.meta,
        // El critico IA no aprobo alguna pieza: el Content Studio muestra
        // el aviso "Revisar creativo" — la decision final es humana.
        needsReview: cover.meta.approved === false || story.meta.approved === false
      },
      // Trazabilidad: esta corrida uso (o no) el Property Context del DCE.
      cognitiveContext: Boolean(cognitive)
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
  const cognitive = await loadCognitiveContext(publication.org_id, property.id);
  const copyResult = await generateCopy(
    buildPropertyCopyInput(property),
    styleVariant,
    { name: brand.name },
    undefined,
    cognitive ? copywriterBriefFromContext(cognitive) : undefined
  );

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

export type RegenerableRole = "cover" | "story";

export interface RegenerateCreativeResult {
  role: RegenerableRole;
  score: number;
  approved: boolean;
  rounds: number;
  problemas: string[];
}

export interface RegenerateCreativeDeps {
  aiCreative?: typeof generateAiCreative;
  designerCreative?: typeof generateDesignerCreative;
  upload?: typeof uploadCreative;
  recordGeneration?: typeof recordContentGeneration;
  recordEvent?: typeof recordPublicationEvent;
  now?: () => number;
}

/**
 * Guard puro (sin IO) de `regenerateCreativeForPublication`: hay una razon
 * valida para gastar una corrida si el humano escribio notas, reenvia el
 * feedback del critico, o eligio una foto fuente distinta a la actual —
 * cualquiera de las tres solas ya justifica regenerar.
 */
export function hasRegenerationInput(notes: string, criticInstructions: string[], sourceImageUrl?: string): boolean {
  return Boolean(notes.trim()) || criticInstructions.some((i) => i.trim().length > 0) || Boolean(sourceImageUrl?.trim());
}

export interface CoverCandidate {
  imageUrl: string;
  roomType: RoomType;
  qualityScore: number;
  brightnessScore: number;
  isDark: boolean;
  /** true = la foto que el ranking pondria de primera (ver rankImages) — con brief cognitivo, ya considera que tanto sirve la estrategia. */
  recommended: boolean;
  /** true = la foto fuente que hoy tiene el asset de ese rol en la publicacion. */
  current: boolean;
  /** Solo si la propiedad tiene brief cognitivo: que tan bien esta foto especifica sirve la direccion creativa (ver scoreImagesForBrief). */
  briefFitScore?: number;
  briefFitReason?: string;
}

/**
 * Candidatas para elegir a mano la foto fuente de un rol (Content Studio,
 * boton "elegir otra foto"): reusa el MISMO ranking con el que el sistema
 * ya elige la portada por defecto (ver ai/image-selector.ts), incluido el
 * ajuste por brief cognitivo si la propiedad tiene uno — para que la
 * recomendada (⭐) en este picker sea la misma logica que generateDraftForProperty,
 * no una version ciega a la estrategia. El analisis objetivo por foto esta
 * cacheado desde generateDraftForProperty (no vuelve a llamar a Claude salvo
 * fotos nuevas); el brief-fit NO se cachea (ver scoreImagesForBrief), asi que
 * abrir el picker si hay brief cuesta una llamada extra a Claude vision.
 * Oscuras y duplicadas quedan fuera (rankImages ya las filtra).
 */
export async function listCoverCandidates(publicationId: string, role: RegenerableRole): Promise<CoverCandidate[]> {
  const publication = await getPublicationById(publicationId);
  if (!publication) throw new FatalError(`Publicacion ${publicationId} no existe`);
  if (!publication.property_id) throw new FatalError(`Publicacion ${publicationId} no tiene propiedad asociada`);

  const property = await getPropertyById(publication.property_id);
  if (!property) throw new FatalError(`Propiedad ${publication.property_id} no existe`);
  if (!property.images || property.images.length === 0) return [];

  const [analyses, assets, cognitive] = await Promise.all([
    analyzeImages(publication.org_id, property.id, property.images),
    listAssetsByPublication(publicationId),
    loadCognitiveContext(publication.org_id, property.id)
  ]);
  const creativeBrief = cognitive ? directorBriefFromContext(cognitive) : undefined;
  const briefFit = creativeBrief ? await scoreImagesForBrief(rankImages(analyses), creativeBrief) : undefined;
  const ranked = rankImages(analyses, briefFit);
  const current = assets.find((a) => a.role === role && a.position === 0);

  return ranked.map((a, i) => ({
    imageUrl: a.imageUrl,
    roomType: a.roomType,
    qualityScore: a.qualityScore,
    brightnessScore: a.brightnessScore,
    isDark: a.isDark,
    ...(briefFit?.has(a.imageUrl)
      ? { briefFitScore: briefFit.get(a.imageUrl)!.briefFitScore, briefFitReason: briefFit.get(a.imageUrl)!.reason }
      : {}),
    recommended: i === 0,
    current: a.imageUrl === current?.source_image_url
  }));
}

/**
 * "Regenerar creativo con notas" desde el Content Studio: el humano actua
 * como tercer director y escribe los cambios que quiere (ej "quita el overlay
 * oscuro, agranda el precio"); se re-corre el motor IA inyectando esas notas
 * con prioridad en el prompt. Tambien acepta (ademas o en lugar de las notas)
 * las instrucciones de mejora que dejo el critico en la corrida anterior
 * (`criticInstructions`, boton "corregir con las recomendaciones del
 * critico") — entran como MANDATORY CORRECTIONS desde la ronda 1. Y acepta
 * (ademas o en lugar de ambas) `sourceImageUrl`: el humano puede elegir a
 * mano OTRA foto real de la propiedad (boton "elegir otra foto" del Content
 * Studio, ver listCoverCandidates) en vez de la que el ranking automatico
 * puso por defecto — sin foto nueva, se regenera sobre la MISMA de siempre.
 * Cualquiera de las tres razones sola ya justifica una corrida (ver
 * hasRegenerationInput). Funciona con cualquier motor de IA (ai, designer o
 * hybrid — la plantilla clasica "template" no interpreta instrucciones, esa
 * si sigue bloqueada) y solo en 'draft'. Reemplaza la imagen del rol (y sus
 * copias: thumbnail y slide 0 del carrusel comparten el archivo de la
 * portada, incluida la foto fuente para trazabilidad). El registro y el
 * evento no son criticos: si fallan, el creativo regenerado NO se descarta.
 */
export async function regenerateCreativeForPublication(
  publicationId: string,
  role: RegenerableRole,
  userNotes: string,
  actor: string,
  deps: RegenerateCreativeDeps = {},
  criticInstructions: string[] = [],
  sourceImageUrl?: string
): Promise<RegenerateCreativeResult> {
  const notes = userNotes.trim();
  const feedback = criticInstructions.map((i) => i.trim()).filter(Boolean);
  const requestedSource = sourceImageUrl?.trim() || undefined;
  if (!hasRegenerationInput(userNotes, criticInstructions, sourceImageUrl)) {
    throw new FatalError("Para regenerar el creativo escribe notas, envia las instrucciones del critico, o elegi otra foto");
  }

  const publication = await getPublicationById(publicationId);
  if (!publication) throw new FatalError(`Publicacion ${publicationId} no existe`);
  if (publication.status !== "draft") {
    throw new FatalError(`Solo se puede regenerar el creativo de una publicacion en 'draft' (esta en '${publication.status}')`);
  }
  if (!publication.property_id) throw new FatalError(`Publicacion ${publicationId} no tiene propiedad asociada`);

  const engine = await resolveCreativeEngine(publication.org_id);
  if (engine === "template") {
    throw new FatalError("Regenerar el creativo con notas requiere un motor de IA (designer, hybrid o ai) — el motor 'template' no interpreta instrucciones. Cambialo en Configuracion.");
  }

  const property = await getPropertyById(publication.property_id);
  if (!property) throw new FatalError(`Propiedad ${publication.property_id} no existe`);

  const brand = await resolveBrandProfile(publication.org_id);

  const assets = await listAssetsByPublication(publicationId);
  const current = assets.find((a) => a.role === role && a.position === 0);
  if (!current?.source_image_url) {
    throw new FatalError(`La publicacion no tiene un asset '${role}' con foto fuente para regenerar`);
  }
  const effectiveSource = requestedSource ?? current.source_image_url;

  const styleVariant = (publication.style_variant ?? "premium") as StyleVariant;
  const sizeKey: GptImageSizeKey = role === "story" ? "ig_story" : "ig_feed";
  const format = role === "story" ? ("story" as const) : ("feed" as const);

  const aiCreative = deps.aiCreative ?? generateAiCreative;
  const designerCreative = deps.designerCreative ?? generateDesignerCreative;
  const upload = deps.upload ?? uploadCreative;
  const recordGeneration = deps.recordGeneration ?? recordContentGeneration;
  const recordEvent = deps.recordEvent ?? recordPublicationEvent;
  const now = deps.now ?? Date.now;

  const cognitive = await loadCognitiveContext(publication.org_id, property.id);
  const directorInput = {
    property: buildPropertyCopyInput(property),
    styleVariant,
    tituloComercial: publication.titulo_comercial ?? property.titulo,
    cta: publication.cta ?? "",
    format,
    brand: { name: brand.name },
    ...(cognitive ? { cognitiveBrief: directorBriefFromContext(cognitive) } : {})
  };

  const ai: AiCreativeResult | DesignerCreativeResult =
    engine === "ai"
      ? await aiCreative(brand, directorInput, effectiveSource, sizeKey, {}, notes || undefined, feedback)
      : await designerCreative(brand, directorInput, effectiveSource, sizeKey, engine, {}, notes || undefined, feedback);
  const photoEnhanced = "photoEnhanced" in ai && ai.photoEnhanced;

  const uploaded = await upload(publication.org_id, publicationId, role, 0, ai.buffer);
  // Cache-bust: uploadCreative sobreescribe el mismo path (upsert), asi que
  // sin cambiar la URL el CDN/navegador seguiria mostrando la version vieja.
  const bustedUrl = `${uploaded.publicUrl}?v=${now()}`;

  // La portada se reusa como thumbnail y como slide 0 del carrusel (mismo
  // archivo): actualizarlos juntos evita que queden desincronizados. Si el
  // humano eligio otra foto, source_image_url tambien se actualiza en los
  // tres — sin esto quedaria trazado el archivo pero no la foto real de origen.
  const rolesToUpdate: PublicationAssetRow["role"][] = role === "cover" ? ["cover", "thumbnail", "carousel"] : ["story"];
  await updateAssetsImageAtPosition0(publicationId, rolesToUpdate, {
    storage_path: uploaded.storagePath,
    public_url: bustedUrl,
    width: ai.width,
    height: ai.height,
    format: ai.format,
    ...(requestedSource ? { source_image_url: requestedSource } : {})
  });

  const feedbackMeta = criticFeedbackMeta(ai);
  const problemas = feedbackMeta.problemas ?? [];

  try {
    await recordGeneration({
      org_id: publication.org_id,
      property_id: property.id,
      publication_id: publicationId,
      kind: "image_generation",
      style_variant: styleVariant,
      model: engine === "ai" ? env.GPT_IMAGE_MODEL : photoEnhanced ? "claude+gemini" : "claude",
      prompt_version: ai.promptVersion,
      input: {
        role,
        sizeKey,
        engine,
        regenerated: true,
        userNotes: notes,
        criticInstructions: feedback,
        sourceImageUrl: effectiveSource,
        sourceImageChangedByHuman: Boolean(requestedSource),
        masterPrompt: ai.masterPrompt,
        headline: ai.headline
      },
      output: {
        approved: ai.approved,
        finalScore: ai.finalScore,
        roundsUsed: ai.rounds.length,
        rounds: ai.rounds,
        logoApplied: ai.logoApplied,
        storagePath: uploaded.storagePath,
        estimatedCostUsd:
          engine === "ai" ? Number((ai.rounds.length * COST_PER_GPT_IMAGE_USD).toFixed(2)) : photoEnhanced ? Number(COST_PER_GEMINI_IMAGE_USD.toFixed(3)) : 0
      },
      tokens_in: ai.tokensIn,
      tokens_out: ai.tokensOut
    });
  } catch (err) {
    logger.warn({ err, publicationId, role }, "No se pudo registrar la regeneracion en content_generations");
  }

  const meta: CreativeMeta = {
    engine,
    score: ai.finalScore,
    approved: ai.approved,
    rounds: ai.rounds.length,
    ...feedbackMeta
  };
  try {
    // Evento draft->draft (auditoria): el Content Studio deriva el estado
    // "Revisar creativo" tomando, por rol, el meta del evento mas reciente
    // que lo menciona — asi una regeneracion aprobada limpia el aviso viejo.
    await recordEvent({
      publication_id: publicationId,
      org_id: publication.org_id,
      from_status: "draft",
      to_status: "draft",
      actor,
      detail: {
        source: "regenerate-creative",
        regeneratedRole: role,
        userNotes: notes,
        criticInstructions: feedback,
        creative: { [role]: meta }
      }
    });
  } catch (err) {
    logger.warn({ err, publicationId, role }, "No se pudo registrar el evento de regeneracion");
  }

  return { role, score: ai.finalScore, approved: ai.approved, rounds: ai.rounds.length, problemas };
}
