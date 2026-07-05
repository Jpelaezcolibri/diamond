import { FatalError, isFatal } from "../lib/errors.js";
import { deriveStatusFromTargets, type PublicationStatus } from "../domain/publication-status.js";
import { decryptSecret } from "../security/crypto.js";
import { resolveProvider } from "../providers/registry.js";
import type { PublishContext } from "../providers/social-provider.js";
import { claimPublicationForPublishing, getPublicationById, updatePublicationStatus } from "../repositories/publications.repo.js";
import {
  claimTargetForPublishing,
  getPublicationTargetById,
  listTargetsByPublication,
  markTargetFailed,
  markTargetPublished,
  saveIgCreationIds,
  allTargetsSettled
} from "../repositories/publication-targets.repo.js";
import { listAssetsByPublication } from "../repositories/publication-assets.repo.js";
import { getConnectionById } from "../repositories/social-connections.repo.js";
import { recordPublicationEvent } from "../repositories/publication-events.repo.js";
import type { PublicationRow, PublicationAssetRow, SocialPlatform } from "../repositories/types.js";

const PUBLISH_WORKER_ACTOR = "system:publish.worker";

/** Copy + hashtags + CTA en un solo texto, por plataforma — separado para poder testearlo sin red. */
export function buildCaption(publication: PublicationRow, platform: SocialPlatform): string {
  const base = platform === "facebook" ? publication.copy_facebook : publication.copy_instagram;
  const hashtags = (publication.hashtags ?? []).join(" ");
  const parts = [base, publication.cta, hashtags].map((p) => p?.trim()).filter((p): p is string => Boolean(p));
  return parts.join("\n\n");
}

/** Elige, segun el `kind` de la publicacion, que asset(s) van a esta plataforma — separado para poder testearlo sin red. */
export function selectAssetsForPublish(
  kind: PublicationRow["kind"],
  assets: PublicationAssetRow[]
): { imageUrls: string[] } {
  if (kind === "story") {
    const story = assets.find((a) => a.role === "story");
    if (!story?.public_url) throw new FatalError("La publicacion no tiene un asset 'story' renderizado");
    return { imageUrls: [story.public_url] };
  }
  if (kind === "carousel") {
    const carousel = assets
      .filter((a) => a.role === "carousel")
      .sort((a, b) => a.position - b.position)
      .map((a) => a.public_url)
      .filter((url): url is string => Boolean(url));
    if (carousel.length === 0) throw new FatalError("La publicacion no tiene assets 'carousel' renderizados");
    return { imageUrls: carousel };
  }
  const cover = assets.find((a) => a.role === "cover");
  if (!cover?.public_url) throw new FatalError("La publicacion no tiene un asset 'cover' renderizado");
  return { imageUrls: [cover.public_url] };
}

async function recomputePublicationStatus(orgId: string, publicationId: string): Promise<void> {
  const targets = await listTargetsByPublication(publicationId);
  const statuses = targets.map((t) => t.status);
  if (!allTargetsSettled(statuses)) return; // aun hay targets pending/publishing: no tocar el status todavia

  const derived: PublicationStatus = deriveStatusFromTargets(statuses);
  const publication = await getPublicationById(publicationId);
  if (publication && publication.status !== derived) {
    await updatePublicationStatus(publicationId, derived);
    await recordPublicationEvent({
      publication_id: publicationId,
      org_id: orgId,
      from_status: publication.status,
      to_status: derived,
      actor: PUBLISH_WORKER_ACTOR
    });
  }
}

/**
 * Procesa UN publication_target: claim atomico -> publica en la plataforma
 * correspondiente -> marca resultado -> recalcula el estado de la
 * publicacion. Es el corazon de la idempotencia (ver ARCHITECTURE.md #7/#10):
 * si BullMQ reintenta el mismo job, el claim atomico y el resume desde
 * ig_creation_ids evitan publicar dos veces.
 *
 * Lanza (para que BullMQ reintente con backoff) solo si el error es
 * RetryableError; ante un FatalError, marca el target 'failed' y retorna
 * normalmente (sin mas reintentos).
 */
export async function processPublishJob(targetId: string): Promise<void> {
  const target = await claimTargetForPublishing(targetId);
  if (!target) {
    // Otro worker ya tomo este target (o ya estaba published) — nada que hacer.
    return;
  }

  const publication = await getPublicationById(target.publication_id);
  if (!publication) throw new FatalError(`Publicacion ${target.publication_id} no existe`);

  // Si esta es la primera publication_target en arrancar, mueve la
  // publicacion a 'publishing'. Claim atomico: si dos targets arrancan casi
  // a la vez, solo uno gana la fila y registra el evento (ver #7/#10).
  const claimedPublication = await claimPublicationForPublishing(publication.id);
  if (claimedPublication) {
    await recordPublicationEvent({
      publication_id: publication.id,
      org_id: publication.org_id,
      from_status: publication.status, // status justo antes de este claim (approved o scheduled)
      to_status: "publishing",
      actor: PUBLISH_WORKER_ACTOR
    });
  }

  try {
    const connection = await getConnectionById(target.social_connection_id);
    if (!connection) throw new FatalError(`Conexion ${target.social_connection_id} no existe`);

    const assets = await listAssetsByPublication(publication.id);
    const { imageUrls } = selectAssetsForPublish(publication.kind, assets);
    const caption = buildCaption(publication, target.platform);
    const accessToken = decryptSecret(connection.access_token_enc);
    const provider = resolveProvider(target.platform);

    const ctx: PublishContext = {
      existingCreationIds: target.ig_creation_ids ?? undefined,
      persistCreationIds: (ids) => saveIgCreationIds(target.id, ids)
    };

    const result =
      publication.kind === "story" && provider.publishStory
        ? await provider.publishStory(accessToken, connection.external_account_id, { imageUrl: imageUrls[0]! }, ctx)
        : publication.kind === "carousel"
          ? await provider.publishCarousel(accessToken, connection.external_account_id, { imageUrls, caption }, ctx)
          : await provider.publishSingleImage(accessToken, connection.external_account_id, { imageUrl: imageUrls[0]!, caption }, ctx);

    await markTargetPublished(target.id, result.externalPostId, result.permalink);
    await recomputePublicationStatus(publication.org_id, publication.id);
  } catch (err) {
    await markTargetFailed(target.id, (err as Error).message);
    await recomputePublicationStatus(publication.org_id, publication.id);
    if (!isFatal(err)) throw err; // Retryable: se relanza para que BullMQ reintente con backoff
  }
}
