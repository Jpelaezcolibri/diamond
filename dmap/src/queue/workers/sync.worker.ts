import { Worker, type Job } from "bullmq";
import { redisConnectionOptions } from "../connection.js";
import { QUEUE_NAMES } from "../queues.js";
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
    { connection: redisConnectionOptions, concurrency: 1 }
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, "sync.worker: job fallido");
  });

  return worker;
}
