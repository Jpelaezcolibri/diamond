import { Worker, type Job } from "bullmq";
import { redisConnectionOptions } from "../connection.js";
import { QUEUE_NAMES } from "../queues.js";
import { buildPropertyContext, rebuildStaleContexts } from "../../cognitive/application/context-builder.service.js";
import { logger } from "../../lib/logger.js";

interface CognitiveJobData {
  orgId: string;
  propertyId?: string;
}

/**
 * Worker del Diamond Cognitive Engine. Dos jobs en la misma cola:
 * - "build-context" (propiedad nueva o regeneracion manual encolada)
 * - "rebuild-stale" (batch nocturno repetible por org)
 * Concurrencia 1: cada build son 2 llamadas Claude — no hay apuro y evita
 * picos de rate-limit compitiendo con el copywriter/critico del CRM.
 */
export function startCognitiveWorker(): Worker<CognitiveJobData> {
  const worker = new Worker<CognitiveJobData>(
    QUEUE_NAMES.cognitive,
    async (job: Job<CognitiveJobData>) => {
      const { orgId, propertyId } = job.data;
      if (job.name === "rebuild-stale") {
        logger.info({ orgId, jobId: job.id }, "cognitive.worker: batch de contextos stale");
        return rebuildStaleContexts(orgId);
      }
      if (!propertyId) throw new Error("build-context requiere propertyId");
      logger.info({ orgId, propertyId, jobId: job.id }, "cognitive.worker: construyendo Property Context");
      const row = await buildPropertyContext(orgId, propertyId);
      return { propertyRef: row.property_ref, status: row.status };
    },
    { connection: redisConnectionOptions, concurrency: 1 }
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, "cognitive.worker: job fallido");
  });

  return worker;
}
