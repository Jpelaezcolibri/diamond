import { Queue } from "bullmq";
import { redisConnectionOptions } from "./connection.js";
import { PUBLISH_MAX_ATTEMPTS, PUBLISH_RETRY_BACKOFF_MS } from "../config/constants.js";

export const QUEUE_NAMES = {
  sync: "sync",
  generate: "generate",
  publish: "publish",
  metrics: "metrics",
  tokenRefresh: "token-refresh"
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection: redisConnectionOptions });
    queues.set(name, queue);
  }
  return queue;
}

/** jobId deterministico: BullMQ rechaza un job con un id ya existente — primera capa anti-duplicados (ver ARCHITECTURE.md #7/#10). */
export const jobIds = {
  sync: (orgId: string) => `sync:${orgId}`,
  generate: (propertyId: string, styleVariant: string) => `content.generate:${propertyId}:${styleVariant}`,
  publish: (targetId: string, attempt = 0) => (attempt === 0 ? `publish:${targetId}` : `publish:${targetId}:r${attempt}`),
  metrics: (orgId: string) => `metrics:${orgId}`,
  tokenRefresh: (orgId: string) => `token-refresh:${orgId}`
};

export async function enqueueSync(orgId: string, delayMs = 0): Promise<void> {
  await getQueue(QUEUE_NAMES.sync).add("sync", { orgId }, { jobId: jobIds.sync(orgId), delay: delayMs });
}

export async function enqueueGenerate(propertyId: string, styleVariant: string): Promise<void> {
  await getQueue(QUEUE_NAMES.generate).add(
    "generate",
    { propertyId, styleVariant },
    { jobId: jobIds.generate(propertyId, styleVariant) }
  );
}

export async function enqueuePublish(targetId: string, delayMs: number, attempt = 0): Promise<void> {
  await getQueue(QUEUE_NAMES.publish).add(
    "publish",
    { targetId },
    {
      jobId: jobIds.publish(targetId, attempt),
      delay: delayMs,
      attempts: PUBLISH_MAX_ATTEMPTS,
      backoff: { type: "custom" },
      // El backoff real lo calcula publish.worker via PUBLISH_RETRY_BACKOFF_MS
      // (BullMQ custom backoff strategy se registra al construir el Worker).
    }
  );
}

export function backoffForAttempt(attemptsMade: number): number {
  return PUBLISH_RETRY_BACKOFF_MS[Math.min(attemptsMade, PUBLISH_RETRY_BACKOFF_MS.length - 1)] ?? 0;
}
