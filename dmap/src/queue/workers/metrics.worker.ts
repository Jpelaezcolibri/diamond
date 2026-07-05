import { Worker, type Job } from "bullmq";
import { redisConnectionOptions } from "../connection.js";
import { QUEUE_NAMES } from "../queues.js";
import { collectMetricsForOrg } from "../../services/metrics.service.js";
import { logger } from "../../lib/logger.js";

interface MetricsJobData {
  orgId: string;
}

export function startMetricsWorker(): Worker<MetricsJobData> {
  const worker = new Worker<MetricsJobData>(
    QUEUE_NAMES.metrics,
    async (job: Job<MetricsJobData>) => {
      const { orgId } = job.data;
      const result = await collectMetricsForOrg(orgId);
      logger.info({ orgId, ...result }, "metrics.worker: recoleccion completa");
      return result;
    },
    { connection: redisConnectionOptions, concurrency: 1 }
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, "metrics.worker: job fallido");
  });

  return worker;
}
