import { getQueue, QUEUE_NAMES, jobIds } from "../queue/queues.js";
import { listOrgIdsWithMarketingEnabled, getOrgMarketingSettings } from "../repositories/settings.repo.js";
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
