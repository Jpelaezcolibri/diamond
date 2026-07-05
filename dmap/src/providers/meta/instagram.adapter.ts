import { FatalError } from "../../lib/errors.js";
import { IG_MAX_CAROUSEL_ITEMS } from "../../config/constants.js";
import { graphDelete, graphGet, graphPost } from "./graph-client.js";
import type {
  MetricsSnapshot,
  PublishCarouselInput,
  PublishContext,
  PublishResult,
  PublishSingleImageInput,
  PublishStoryInput,
  SocialProvider
} from "../social-provider.js";

async function checkPublishingQuota(accessToken: string, igId: string): Promise<void> {
  const result = await graphGet<{ data: Array<{ quota_usage: number; config: { quota_total: number } }> }>(
    `/${igId}/content_publishing_limit`,
    { fields: "quota_usage,config" },
    accessToken
  );
  const status = result.data[0];
  if (status && status.quota_usage >= status.config.quota_total) {
    throw new FatalError(`Cuota de publicacion de Instagram alcanzada (${status.quota_usage}/${status.config.quota_total} en 24h)`);
  }
}

async function createContainer(accessToken: string, igId: string, body: Record<string, unknown>): Promise<string> {
  const container = await graphPost<{ id: string }>(`/${igId}/media`, body, accessToken);
  return container.id;
}

async function getContainerStatus(accessToken: string, creationId: string): Promise<string> {
  const result = await graphGet<{ status_code: string }>(`/${creationId}`, { fields: "status_code" }, accessToken);
  return result.status_code;
}

/** Reutiliza un container ya creado en un intento previo si sigue vivo; si murio (ERROR/EXPIRED), crea uno nuevo. */
async function getOrCreateContainer(
  accessToken: string,
  igId: string,
  key: string,
  body: Record<string, unknown>,
  ctx: PublishContext | undefined,
  accumulated: Record<string, string>
): Promise<string> {
  const existing = accumulated[key];
  if (existing) {
    const status = await getContainerStatus(accessToken, existing);
    if (status !== "ERROR" && status !== "EXPIRED") return existing;
  }
  const created = await createContainer(accessToken, igId, body);
  accumulated[key] = created;
  await ctx?.persistCreationIds?.({ ...accumulated });
  return created;
}

async function publishContainer(accessToken: string, igId: string, creationId: string): Promise<string> {
  const result = await graphPost<{ id: string }>(`/${igId}/media_publish`, { creation_id: creationId }, accessToken);
  return result.id;
}

async function fetchMediaPermalink(accessToken: string, mediaId: string): Promise<string | null> {
  try {
    const result = await graphGet<{ permalink?: string }>(`/${mediaId}`, { fields: "permalink" }, accessToken);
    return result.permalink ?? null;
  } catch {
    return null;
  }
}

/** Instagram Business adapter — flujo de dos fases contenedor -> publish (ver ARCHITECTURE.md #7). No soporta editar posts publicados. */
export const instagramAdapter: SocialProvider = {
  platform: "instagram",

  async publishSingleImage(accessToken, igId, input: PublishSingleImageInput, ctx): Promise<PublishResult> {
    await checkPublishingQuota(accessToken, igId);
    const accumulated = { ...(ctx?.existingCreationIds ?? {}) };
    const creationId = await getOrCreateContainer(
      accessToken,
      igId,
      "main",
      { image_url: input.imageUrl, caption: input.caption },
      ctx,
      accumulated
    );
    const mediaId = await publishContainer(accessToken, igId, creationId);
    return { externalPostId: mediaId, permalink: await fetchMediaPermalink(accessToken, mediaId) };
  },

  async publishCarousel(accessToken, igId, input: PublishCarouselInput, ctx): Promise<PublishResult> {
    if (input.imageUrls.length > IG_MAX_CAROUSEL_ITEMS) {
      throw new FatalError(`Carrusel de IG admite maximo ${IG_MAX_CAROUSEL_ITEMS} fotos (se pidieron ${input.imageUrls.length})`);
    }
    await checkPublishingQuota(accessToken, igId);
    const accumulated = { ...(ctx?.existingCreationIds ?? {}) };

    const childIds: string[] = [];
    for (let i = 0; i < input.imageUrls.length; i++) {
      const childId = await getOrCreateContainer(
        accessToken,
        igId,
        `child_${i}`,
        { image_url: input.imageUrls[i], is_carousel_item: true },
        ctx,
        accumulated
      );
      childIds.push(childId);
    }

    const parentId = await getOrCreateContainer(
      accessToken,
      igId,
      "parent",
      { media_type: "CAROUSEL", children: childIds, caption: input.caption },
      ctx,
      accumulated
    );

    const mediaId = await publishContainer(accessToken, igId, parentId);
    return { externalPostId: mediaId, permalink: await fetchMediaPermalink(accessToken, mediaId) };
  },

  async publishStory(accessToken, igId, input: PublishStoryInput, ctx): Promise<PublishResult> {
    await checkPublishingQuota(accessToken, igId);
    const accumulated = { ...(ctx?.existingCreationIds ?? {}) };
    const creationId = await getOrCreateContainer(
      accessToken,
      igId,
      "main",
      { media_type: "STORIES", image_url: input.imageUrl },
      ctx,
      accumulated
    );
    const mediaId = await publishContainer(accessToken, igId, creationId);
    return { externalPostId: mediaId, permalink: null };
  },

  async deletePost(accessToken, mediaId): Promise<void> {
    await graphDelete(`/${mediaId}`, accessToken);
  },

  async getMetrics(accessToken, mediaId): Promise<MetricsSnapshot> {
    const insights = await graphGet<{ data: Array<{ name: string; values: Array<{ value: number }> }> }>(
      `/${mediaId}/insights`,
      { metric: "views,reach,likes,comments,shares,saved" },
      accessToken
    );
    const metric = (name: string): number | undefined => insights.data.find((m) => m.name === name)?.values[0]?.value;
    return {
      // Para media creada tras la migracion de "impressions" a "views" (v22+), lo mapeamos igual a la columna impressions.
      impressions: metric("views"),
      reach: metric("reach"),
      likes: metric("likes"),
      comments: metric("comments"),
      shares: metric("shares"),
      saved: metric("saved"),
      raw: insights.data
    };
  }
};
