import { Worker, type Job } from "bullmq";
import { redisConnectionOptions } from "../connection.js";
import { QUEUE_NAMES } from "../queues.js";
import { refreshOrgTokens } from "../../services/connection.service.js";
import { logger } from "../../lib/logger.js";

interface TokenRefreshJobData {
  orgId: string;
}

export function startTokenRefreshWorker(): Worker<TokenRefreshJobData> {
  const worker = new Worker<TokenRefreshJobData>(
    QUEUE_NAMES.tokenRefresh,
    async (job: Job<TokenRefreshJobData>) => {
      const { orgId } = job.data;
      logger.info({ orgId, jobId: job.id }, "token-refresh.worker: revisando tokens de Meta");
      await refreshOrgTokens(orgId);
    },
    { connection: redisConnectionOptions, concurrency: 1 }
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, "token-refresh.worker: job fallido");
  });

  return worker;
}
