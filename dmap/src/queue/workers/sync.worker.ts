import { Worker, type Job } from "bullmq";
import { redisConnectionOptions } from "../connection.js";
import { QUEUE_NAMES, backoffForSyncAttempt } from "../queues.js";
import { SYNC_MAX_ATTEMPTS } from "../../config/constants.js";
import { runSync } from "../../services/sync.service.js";
import { logger } from "../../lib/logger.js";

interface SyncJobData {
  orgId: string;
}

export function startSyncWorker(): Worker<SyncJobData> {
  const worker = new Worker<SyncJobData>(
    QUEUE_NAMES.sync,
    async (job: Job<SyncJobData>) => {
      const { orgId } = job.data;
      logger.info({ orgId, jobId: job.id }, "sync.worker: iniciando corrida");
      const result = await runSync(orgId);
      logger.info({ orgId, ...result }, "sync.worker: corrida terminada");
      return result;
    },
    {
      connection: redisConnectionOptions,
      concurrency: 1,
      // Sin esta estrategia el `backoff: { type: "custom" }` con el que se
      // registra el repetible (scheduler/schedules.ts) no tendria como calcular
      // la espera y los reintentos saldrian todos de inmediato — inutil contra
      // un 502 de Wasi, que es justo lo que motivo los reintentos.
      settings: { backoffStrategy: (attemptsMade) => backoffForSyncAttempt(attemptsMade) }
    }
  );

  worker.on("failed", (job, err) => {
    const ultimo = (job?.attemptsMade ?? 0) >= SYNC_MAX_ATTEMPTS;
    logger.error(
      { jobId: job?.id, attempt: job?.attemptsMade, maxAttempts: SYNC_MAX_ATTEMPTS, err: err.message },
      ultimo
        ? "sync.worker: job fallido y SIN reintentos restantes — el inventario va a quedar viejo y el radar se callara"
        : "sync.worker: job fallido (se reintentara)"
    );
  });

  return worker;
}
