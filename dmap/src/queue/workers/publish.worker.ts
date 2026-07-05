import { Worker, type Job } from "bullmq";
import { redisConnectionOptions } from "../connection.js";
import { QUEUE_NAMES, backoffForAttempt } from "../queues.js";
import { processPublishJob } from "../../services/publish.service.js";
import { logger } from "../../lib/logger.js";

interface PublishJobData {
  targetId: string;
}

export function startPublishWorker(): Worker<PublishJobData> {
  const worker = new Worker<PublishJobData>(
    QUEUE_NAMES.publish,
    async (job: Job<PublishJobData>) => {
      logger.info({ targetId: job.data.targetId, jobId: job.id, attempt: job.attemptsMade }, "publish.worker: procesando target");
      await processPublishJob(job.data.targetId);
    },
    {
      connection: redisConnectionOptions,
      concurrency: 2,
      settings: { backoffStrategy: (attemptsMade) => backoffForAttempt(attemptsMade) }
    }
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, targetId: job?.data.targetId, err: err.message }, "publish.worker: job fallido (se reintentara si es retryable)");
  });

  return worker;
}
