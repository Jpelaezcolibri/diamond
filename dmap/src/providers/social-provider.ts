import type { SocialPlatform } from "../repositories/types.js";

export interface PublishSingleImageInput {
  imageUrl: string;
  caption: string;
}

export interface PublishCarouselInput {
  imageUrls: string[];
  caption: string;
}

export interface PublishStoryInput {
  imageUrl: string;
}

export interface PublishResult {
  externalPostId: string;
  permalink: string | null;
}

/**
 * Idempotencia de publicacion en dos fases (contenedor -> publish, ver
 * ARCHITECTURE.md #7/#10): `existingCreationIds` trae lo que ya se creo en
 * un intento anterior (nunca se re-crean contenedores ya existentes) y
 * `persistCreationIds` se llama ANTES del publish para que un crash entre
 * crear y publicar pueda reanudarse en el proximo intento.
 */
export interface PublishContext {
  existingCreationIds?: Record<string, string>;
  persistCreationIds?: (ids: Record<string, string>) => Promise<void>;
}

export interface MetricsSnapshot {
  impressions?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  clicks?: number;
  saved?: number;
  raw: unknown;
}

/**
 * Capa de abstraccion social (ver ARCHITECTURE.md #7): nada fuera de
 * providers/ debe importar Meta directamente. Agregar LinkedIn, Google
 * Business o TikTok es implementar esta misma interfaz.
 */
export interface SocialProvider {
  readonly platform: SocialPlatform;
  publishSingleImage(accessToken: string, externalAccountId: string, input: PublishSingleImageInput, ctx?: PublishContext): Promise<PublishResult>;
  publishCarousel(accessToken: string, externalAccountId: string, input: PublishCarouselInput, ctx?: PublishContext): Promise<PublishResult>;
  publishStory?(accessToken: string, externalAccountId: string, input: PublishStoryInput, ctx?: PublishContext): Promise<PublishResult>;
  editPost?(accessToken: string, externalPostId: string, caption: string): Promise<void>;
  deletePost(accessToken: string, externalPostId: string): Promise<void>;
  getMetrics(accessToken: string, externalPostId: string): Promise<MetricsSnapshot>;
}
