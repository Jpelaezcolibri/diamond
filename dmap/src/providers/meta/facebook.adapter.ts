import { graphDelete, graphGet, graphPost } from "./graph-client.js";
import type {
  MetricsSnapshot,
  PublishCarouselInput,
  PublishResult,
  PublishSingleImageInput,
  SocialProvider
} from "../social-provider.js";

async function fetchPermalink(accessToken: string, postId: string): Promise<string | null> {
  try {
    const result = await graphGet<{ permalink_url?: string }>(`/${postId}`, { fields: "permalink_url" }, accessToken);
    return result.permalink_url ?? null;
  } catch {
    return null;
  }
}

/** Facebook Pages adapter (ver ARCHITECTURE.md #7). Unico de los dos que soporta editar un post ya publicado. */
export const facebookAdapter: SocialProvider = {
  platform: "facebook",

  async publishSingleImage(accessToken, pageId, input: PublishSingleImageInput): Promise<PublishResult> {
    const photo = await graphPost<{ id: string; post_id?: string }>(
      `/${pageId}/photos`,
      { url: input.imageUrl, caption: input.caption },
      accessToken
    );
    const postId = photo.post_id ?? photo.id;
    return { externalPostId: postId, permalink: await fetchPermalink(accessToken, postId) };
  },

  async publishCarousel(accessToken, pageId, input: PublishCarouselInput): Promise<PublishResult> {
    const mediaIds: string[] = [];
    for (const url of input.imageUrls) {
      const photo = await graphPost<{ id: string }>(`/${pageId}/photos`, { url, published: false }, accessToken);
      mediaIds.push(photo.id);
    }
    const feedPost = await graphPost<{ id: string }>(
      `/${pageId}/feed`,
      { message: input.caption, attached_media: mediaIds.map((id) => ({ media_fbid: id })) },
      accessToken
    );
    return { externalPostId: feedPost.id, permalink: await fetchPermalink(accessToken, feedPost.id) };
  },

  async editPost(accessToken, postId, caption): Promise<void> {
    await graphPost(`/${postId}`, { message: caption }, accessToken);
  },

  async deletePost(accessToken, postId): Promise<void> {
    await graphDelete(`/${postId}`, accessToken);
  },

  async getMetrics(accessToken, postId): Promise<MetricsSnapshot> {
    const [insights, post] = await Promise.all([
      graphGet<{ data: Array<{ name: string; values: Array<{ value: number }> }> }>(
        `/${postId}/insights`,
        { metric: "post_impressions,post_impressions_unique,post_clicks" },
        accessToken
      ),
      graphGet<{ likes?: { summary: { total_count: number } }; comments?: { summary: { total_count: number } }; shares?: { count: number } }>(
        `/${postId}`,
        { fields: "likes.summary(true),comments.summary(true),shares" },
        accessToken
      )
    ]);

    const metric = (name: string): number | undefined => insights.data.find((m) => m.name === name)?.values[0]?.value;

    return {
      impressions: metric("post_impressions"),
      reach: metric("post_impressions_unique"),
      clicks: metric("post_clicks"),
      likes: post.likes?.summary.total_count,
      comments: post.comments?.summary.total_count,
      shares: post.shares?.count,
      raw: { insights: insights.data, likes: post.likes, comments: post.comments, shares: post.shares }
    };
  }
};
