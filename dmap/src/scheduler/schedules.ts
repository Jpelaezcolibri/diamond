import { getQueue, QUEUE_NAMES, jobIds } from "../queue/queues.js";
import { listOrgIdsWithMarketingEnabled, getOrgMarketingSettings } from "../repositories/settings.repo.js";
import {
  COGNITIVE_REBUILD_CRON,
  METRICS_INTERVAL_HOURS,
  SYNC_MAX_ATTEMPTS,
  TOKEN_REFRESH_INTERVAL_DAYS
} from "../config/constants.js";
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

    await registrarSyncConReintentos(queue, jobId, orgId, desiredEvery);
    logger.info({ orgId, intervalMinutes: settings.sync_interval_minutes }, "Sync repetible registrado");
  }
}

/**
 * Registra el repetible de sync CON reintentos, y se asegura de que la
 * iteracion ya encolada tambien los tenga.
 *
 * POR QUE `attempts` (incidente del 2026-08-22): Wasi devolvio un 502 en
 * /property/search y el sync murio en 7 segundos. Sin reintentos la corrida se
 * perdia hasta la siguiente —24 h en Diamond— y a las 30 h del ultimo sync
 * exitoso el bot marca todo el inventario como `sync_viejo`
 * (src/groups/publicable.js): el radar de grupos se callo ante tres pedidos con
 * match, uno de puntaje 99. Ver SYNC_RETRY_BACKOFF_MS.
 *
 * POR QUE HAY QUE BORRAR LA ITERACION PENDIENTE: el lua de BullMQ
 * (addStandardJob-9.lua) ve que el jobId de la proxima iteracion ya existe y
 * devuelve sin tocarlo, y cada iteracion hereda las opciones de la anterior.
 * Sin borrarla, un cambio de `attempts` no entraria NUNCA — ni con redeploy, ni
 * con el paso de los dias. Es el mismo tipo de trampa que ya documenta
 * reconcileSyncSchedules para el cambio de `every`.
 *
 * Borrarla no mueve la cadencia: con `every`, BullMQ alinea cada disparo a un
 * multiplo del intervalo contado desde el epoch —por eso el sync de Diamond cae
 * siempre a las 00:00 UTC—, asi que la iteracion recreada queda en el mismo
 * instante que la que se borro.
 */
async function registrarSyncConReintentos(
  queue: ReturnType<typeof getQueue>,
  jobId: string,
  orgId: string,
  every: number
): Promise<void> {
  const opciones = {
    jobId,
    repeat: { every },
    attempts: SYNC_MAX_ATTEMPTS,
    backoff: { type: "custom" }
  };

  await queue.add("sync", { orgId }, opciones);

  const desactualizadas = (await queue.getDelayed()).filter(
    (job) => job.opts?.repeat && job.data?.orgId === orgId && job.opts.attempts !== SYNC_MAX_ATTEMPTS
  );
  if (!desactualizadas.length) return;

  for (const job of desactualizadas) {
    await job.remove();
    logger.warn(
      { orgId, jobId: job.id, attempts: job.opts?.attempts, esperado: SYNC_MAX_ATTEMPTS },
      "Iteracion de sync encolada sin los reintentos vigentes: se borra para recrearla"
    );
  }
  await queue.add("sync", { orgId }, opciones);
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

/**
 * Batch nocturno del DCE: regenera los Property Contexts stale/failed de cada
 * org (politica del usuario 2026-07-06: el sync solo marca stale; la
 * regeneracion con costo va en lote de madrugada, en el timezone de la org).
 */
export async function reconcileCognitiveSchedules(): Promise<void> {
  const orgIds = await listOrgIdsWithMarketingEnabled();
  const queue = getQueue(QUEUE_NAMES.cognitive);

  for (const orgId of orgIds) {
    const settings = await getOrgMarketingSettings(orgId);
    await queue.add(
      "rebuild-stale",
      { orgId },
      {
        jobId: jobIds.cognitiveRebuild(orgId),
        repeat: { pattern: COGNITIVE_REBUILD_CRON, tz: settings.timezone }
      }
    );
    logger.info({ orgId, cron: COGNITIVE_REBUILD_CRON, tz: settings.timezone }, "Rebuild nocturno de contextos registrado");
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
