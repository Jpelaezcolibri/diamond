import { getQueue, QUEUE_NAMES, jobIds } from "../queue/queues.js";
import { listOrgIdsWithMarketingEnabled, getOrgMarketingSettings } from "../repositories/settings.repo.js";
import { METRICS_INTERVAL_HOURS, TOKEN_REFRESH_INTERVAL_DAYS } from "../config/constants.js";
import { logger } from "../lib/logger.js";

/**
 * Reconciliar los jobs repetibles de sync con org_marketing_settings.
 * Se corre al boot y se vuelve a llamar cuando se guarda la configuracion de
 * una org (ver settings.routes.ts) para que un cambio de cadencia aplique de
 * inmediato, sin esperar a un redeploy (ver dmap/ARCHITECTURE.md #9).
 *
 * BullMQ deriva la "key" de un repeatable de {name, id, every/pattern}: si se
 * llama queue.add() con el mismo jobId pero un `every` distinto (ej. cambiar
 * el intervalo de sync desde el CRM), NO reemplaza el repeatable anterior —
 * crea uno nuevo con una key distinta y el viejo sigue disparando jobs para
 * siempre. Antes de (re)registrar, se listan y eliminan explicitamente: (a)
 * cualquier repeatable de una org que ya no tiene marketing habilitado, y
 * (b) cualquier repeatable de una org valida cuyo `every` no coincide con el
 * configurado actualmente (residuo de un cambio de intervalo anterior).
 */
export async function reconcileSyncSchedules(): Promise<void> {
  const orgIds = await listOrgIdsWithMarketingEnabled();
  const queue = getQueue(QUEUE_NAMES.sync);
  const validJobIds = new Set(orgIds.map((id) => jobIds.sync(id)));

  const existing = await queue.getRepeatableJobs();
  for (const job of existing) {
    if (!job.id || !validJobIds.has(job.id)) {
      await queue.removeRepeatableByKey(job.key);
      logger.info({ key: job.key, id: job.id }, "Sync repetible huerfano eliminado");
    }
  }

  for (const orgId of orgIds) {
    const settings = await getOrgMarketingSettings(orgId);
    const jobId = jobIds.sync(orgId);
    const desiredEvery = settings.sync_interval_minutes * 60_000;

    const staleForOrg = existing.filter((job) => job.id === jobId && String(job.every) !== String(desiredEvery));
    for (const stale of staleForOrg) {
      await queue.removeRepeatableByKey(stale.key);
      logger.info({ orgId, previousEvery: stale.every }, "Sync repetible desactualizado eliminado");
    }

    await queue.add("sync", { orgId }, { jobId, repeat: { every: desiredEvery } });
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
