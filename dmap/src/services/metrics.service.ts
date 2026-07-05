import { logger } from "../lib/logger.js";
import { decryptSecret } from "../security/crypto.js";
import { resolveProvider } from "../providers/registry.js";
import { getConnectionById } from "../repositories/social-connections.repo.js";
import { recordMetricsSnapshot } from "../repositories/metrics.repo.js";
import { getSupabase } from "../repositories/supabase.js";
import type { PublicationTargetRow } from "../repositories/types.js";

const METRICS_LOOKBACK_DAYS = 30;

/** Targets publicados en los ultimos METRICS_LOOKBACK_DAYS dias — insumo del metrics.worker. */
async function listRecentPublishedTargets(orgId: string): Promise<PublicationTargetRow[]> {
  const since = new Date(Date.now() - METRICS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await getSupabase()
    .from("publication_targets")
    .select("*, publications!inner(org_id)")
    .eq("status", "published")
    .eq("publications.org_id", orgId)
    .gte("published_at", since);
  if (error) throw new Error(`listRecentPublishedTargets: ${error.message}`);
  return (data as PublicationTargetRow[]) ?? [];
}

/**
 * Recoleccion de metricas (ver dmap/ARCHITECTURE.md #5/#10): por cada target
 * publicado en los ultimos 30 dias, pide insights a Meta y guarda un
 * snapshot. Un fallo puntual (token vencido, post borrado en la plataforma)
 * no aborta la corrida completa — se registra y se sigue con el resto.
 */
export async function collectMetricsForOrg(orgId: string): Promise<{ collected: number; errors: number }> {
  const targets = await listRecentPublishedTargets(orgId);
  let collected = 0;
  let errors = 0;

  for (const target of targets) {
    if (!target.external_post_id) continue;
    try {
      const connection = await getConnectionById(target.social_connection_id);
      if (!connection) continue;

      const provider = resolveProvider(target.platform);
      const accessToken = decryptSecret(connection.access_token_enc);
      const snapshot = await provider.getMetrics(accessToken, target.external_post_id);

      await recordMetricsSnapshot({
        org_id: orgId,
        publication_target_id: target.id,
        impressions: snapshot.impressions,
        reach: snapshot.reach,
        likes: snapshot.likes,
        comments: snapshot.comments,
        shares: snapshot.shares,
        clicks: snapshot.clicks,
        saved: snapshot.saved,
        raw: snapshot.raw as Record<string, unknown>
      });
      collected += 1;
    } catch (err) {
      errors += 1;
      logger.error({ err, targetId: target.id }, "No se pudieron recolectar metricas para este target");
    }
  }

  return { collected, errors };
}
