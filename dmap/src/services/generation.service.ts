import { env } from "../config/env.js";
import { FatalError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { COST_PER_GPT_IMAGE_USD, GPT_IMAGE_QUALITY, GPT_IMAGE_SIZES, type GptImageSizeKey, type StyleVariant } from "../config/constants.js";
import { analyzeImages, selectAssets } from "../ai/image-selector.js";
import { generateCopy, type CopywriterOutput } from "../ai/copywriter.js";
import type { CopywriterPropertyInput } from "../ai/prompts/copywriter.v1.js";
import { isGptImageConfigured } from "../ai/gpt-image.js";
import { resolveBrandProfile, type BrandProfile } from "../creatives/brand.js";
import { prepareCarouselPhoto } from "../creatives/compose.js";
import { renderCreative, type CreativeInput } from "../creatives/renderer.js";
import { generateAiCreative } from "../creatives/ai-engine.js";
import { uploadCreative } from "../creatives/storage.js";
import { getPropertyById, type PropertyRow } from "../repositories/properties.repo.js";
import { createPublication, getPublicationById, updatePublicationContent, updatePublicationKind } from "../repositories/publications.repo.js";
import { createPublicationAssets, listAssetsByPublication, updateAssetsImageAtPosition0, type CreateAssetInput } from "../repositories/publication-assets.repo.js";
import { recordPublicationEvent } from "../repositories/publication-events.repo.js";
import { recordContentGeneration } from "../repositories/content-generations.repo.js";
import { markChangeEventsProcessedForProperty } from "../repositories/sync.repo.js";
import { getOrgMarketingSettings } from "../repositories/settings.repo.js";
import type { CreativeEngine, PublicationAssetRow } from "../repositories/types.js";

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

/** Deps inyectables para testear el armado del carrusel sin red. */
export interface CarouselDeps {
  fetchFn?: typeof fetch;
  prepare?: typeof prepareCarouselPhoto;
  upload?: typeof uploadCreative;
}

/**
 * Slides del carrusel a partir de las fotos reales rankeadas (sin el cover:
 * el creative IA ya protagoniza esa foto y va de slide 1). Cada foto se
 * recorta a 1080x1080 y se sube al bucket (Meta exige URL publica; ademas
 * unifica el ratio de todos los hijos del carrusel). Una foto que falle se
 * omite con warn — un slide menos no debe tumbar la generacion completa.
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
        const response = await fetchFn(url);
        if (!response.ok) throw new Error(`descarga fallo con status ${response.status}`);
        const source = Buffer.from(await response.arrayBuffer());
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

  const analyses = await analyzeImages(orgId, propertyId, property.images);
  const assets = selectAssets(analyses);
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
    produceAsset(engine, brand, property, copyResult.output, styleVariant, assets.cover, "ig_feed", orgId, publication.id, "cover"),
    produceAsset(engine, brand, property, copyResult.output, styleVariant, assets.story, "ig_story", orgId, publication.id, "story"),
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
  upload?: typeof uploadCreative;
  recordGeneration?: typeof recordContentGeneration;
  recordEvent?: typeof recordPublicationEvent;
  now?: () => number;
}

/**
 * "Regenerar creativo con notas" desde el Content Studio: el humano actua
 * como tercer director y escribe los cambios que quiere (ej "quita el overlay
 * oscuro, agranda el precio"); se re-corre el motor IA sobre la MISMA foto,
 * inyectando esas notas con prioridad en el prompt. Solo motor IA (la
 * plantilla no interpreta instrucciones) y solo en 'draft'. Reemplaza la
 * imagen del rol (y sus copias: thumbnail y slide 0 del carrusel comparten
 * el archivo de la portada). El registro y el evento no son criticos: si
 * fallan, el creativo regenerado NO se descarta.
 */
export async function regenerateCreativeForPublication(
  publicationId: string,
  role: RegenerableRole,
  userNotes: string,
  actor: string,
  deps: RegenerateCreativeDeps = {}
): Promise<RegenerateCreativeResult> {
  const notes = userNotes.trim();
  if (!notes) throw new FatalError("Las notas para regenerar el creativo no pueden estar vacias");

  const publication = await getPublicationById(publicationId);
  if (!publication) throw new FatalError(`Publicacion ${publicationId} no existe`);
  if (publication.status !== "draft") {
    throw new FatalError(`Solo se puede regenerar el creativo de una publicacion en 'draft' (esta en '${publication.status}')`);
  }
  if (!publication.property_id) throw new FatalError(`Publicacion ${publicationId} no tiene propiedad asociada`);

  const engine = await resolveCreativeEngine(publication.org_id);
  if (engine !== "ai") {
    throw new FatalError("Regenerar el creativo con notas requiere el motor IA (activa OPENAI_API_KEY y el motor 'ai' en Configuracion)");
  }

  const property = await getPropertyById(publication.property_id);
  if (!property) throw new FatalError(`Propiedad ${publication.property_id} no existe`);

  const brand = await resolveBrandProfile(publication.org_id);

  const assets = await listAssetsByPublication(publicationId);
  const current = assets.find((a) => a.role === role && a.position === 0);
  if (!current?.source_image_url) {
    throw new FatalError(`La publicacion no tiene un asset '${role}' con foto fuente para regenerar`);
  }

  const styleVariant = (publication.style_variant ?? "premium") as StyleVariant;
  const sizeKey: GptImageSizeKey = role === "story" ? "ig_story" : "ig_feed";
  const format = role === "story" ? ("story" as const) : ("feed" as const);

  const aiCreative = deps.aiCreative ?? generateAiCreative;
  const upload = deps.upload ?? uploadCreative;
  const recordGeneration = deps.recordGeneration ?? recordContentGeneration;
  const recordEvent = deps.recordEvent ?? recordPublicationEvent;
  const now = deps.now ?? Date.now;

  const ai = await aiCreative(
    brand,
    {
      property: buildPropertyCopyInput(property),
      styleVariant,
      tituloComercial: publication.titulo_comercial ?? property.titulo,
      cta: publication.cta ?? "",
      format,
      brand: { name: brand.name }
    },
    current.source_image_url,
    sizeKey,
    {},
    notes
  );

  const uploaded = await upload(publication.org_id, publicationId, role, 0, ai.buffer);
  // Cache-bust: uploadCreative sobreescribe el mismo path (upsert), asi que
  // sin cambiar la URL el CDN/navegador seguiria mostrando la version vieja.
  const bustedUrl = `${uploaded.publicUrl}?v=${now()}`;

  // La portada se reusa como thumbnail y como slide 0 del carrusel (mismo
  // archivo): actualizarlos juntos evita que queden desincronizados.
  const rolesToUpdate: PublicationAssetRow["role"][] = role === "cover" ? ["cover", "thumbnail", "carousel"] : ["story"];
  await updateAssetsImageAtPosition0(publicationId, rolesToUpdate, {
    storage_path: uploaded.storagePath,
    public_url: bustedUrl,
    width: ai.width,
    height: ai.height,
    format: ai.format
  });

  const problemas = ai.approved ? [] : (ai.rounds[ai.rounds.length - 1]?.problemas.slice(0, 6) ?? []);

  try {
    await recordGeneration({
      org_id: publication.org_id,
      property_id: property.id,
      publication_id: publicationId,
      kind: "image_generation",
      style_variant: styleVariant,
      model: env.GPT_IMAGE_MODEL,
      prompt_version: ai.promptVersion,
      input: { role, sizeKey, regenerated: true, userNotes: notes, sourceImageUrl: current.source_image_url, masterPrompt: ai.masterPrompt, headline: ai.headline },
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
    logger.warn({ err, publicationId, role }, "No se pudo registrar la regeneracion IA en content_generations");
  }

  const meta: CreativeMeta = {
    engine: "ai",
    score: ai.finalScore,
    approved: ai.approved,
    rounds: ai.rounds.length,
    ...(ai.approved ? {} : { problemas })
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
        creative: { [role]: meta }
      }
    });
  } catch (err) {
    logger.warn({ err, publicationId, role }, "No se pudo registrar el evento de regeneracion");
  }

  return { role, score: ai.finalScore, approved: ai.approved, rounds: ai.rounds.length, problemas };
}
