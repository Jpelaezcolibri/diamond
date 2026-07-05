import { getQueue, QUEUE_NAMES, jobIds } from "../queue/queues.js";
import { listOrgIdsWithMarketingEnabled, getOrgMarketingSettings } from "../repositories/settings.repo.js";
import { METRICS_INTERVAL_HOURS, TOKEN_REFRESH_INTERVAL_DAYS } from "../config/constants.js";
import { logger } from "../lib/logger.js";

/**
 * Reconciliar los jobs repetibles de sync con org_marketing_settings.
 * Se corre al boot y puede volver a llamarse cuando cambie la configuracion
 * de una org — agregar/quitar orgs o cambiar cadencias no requiere deploy
 * (ver dmap/ARCHITECTURE.md #9).
 */
export async function reconcileSyncSchedules(): Promise<void> {
  const orgIds = await listOrgIdsWithMarketingEnabled();
  const queue = getQueue(QUEUE_NAMES.sync);

  for (const orgId of orgIds) {
    const settings = await getOrgMarketingSettings(orgId);
    await queue.add(
      "sync",
      { orgId },
      {
        jobId: jobIds.sync(orgId),
        repeat: { every: settings.sync_interval_minutes * 60_000 }
      }
    );
    logger.info({ orgId, intervalMinutes: settings.sync_interval_minutes }, "Sync repetible registrado");
  }
}

/** Reconciliar el refresh semanal de tokens de Meta (ver ARCHITECTURE.md #8). */
export async function reconcileTokenRefreshSchedules(): Promise<void> {
  const orgIds = await listOrgIdsWithMarketingEnabled();
  const queue = getQueue(QUEUE_NAMES.tokenRefresh);

  for (const orgId of orgIds) {
    await queue.add(
      "token-refresh",
      { orgId },
      {
        jobId: jobIds.tokenRefresh(orgId),
        repeat: { every: TOKEN_REFRESH_INTERVAL_DAYS * 24 * 60 * 60_000 }
      }
    );
    logger.info({ orgId }, "Token-refresh repetible registrado");
  }
}

/** Reconciliar la recoleccion de metricas cada METRICS_INTERVAL_HOURS (ver ARCHITECTURE.md #5). */
export async function reconcileMetricsSchedules(): Promise<void> {
  const orgIds = await listOrgIdsWithMarketingEnabled();
  const queue = getQueue(QUEUE_NAMES.metrics);

  for (const orgId of orgIds) {
    await queue.add(
      "metrics",
      { orgId },
      {
        jobId: jobIds.metrics(orgId),
        repeat: { every: METRICS_INTERVAL_HOURS * 60 * 60_000 }
      }
    );
    logger.info({ orgId }, "Metrics repetible registrado");
  }
}
