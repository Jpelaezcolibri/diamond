import { Queue } from "bullmq";
import { redisConnectionOptions } from "./connection.js";
import { PUBLISH_MAX_ATTEMPTS, PUBLISH_RETRY_BACKOFF_MS } from "../config/constants.js";

export const QUEUE_NAMES = {
  sync: "sync",
  generate: "generate",
  publish: "publish",
  metrics: "metrics",
  tokenRefresh: "token-refresh",
  cognitive: "cognitive"
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

/**
 * jobId deterministico: BullMQ rechaza un job con un id ya existente —
 * primera capa anti-duplicados (ver ARCHITECTURE.md #7/#10).
 *
 * OJO con los ":" — BullMQ exige que un jobId personalizado, si contiene
 * ":", tenga EXACTAMENTE 3 partes al separarlo por ":" (compatibilidad con
 * el formato legado de repeatables, ver node_modules/bullmq/dist/cjs/classes/job.js);
 * si no, lanza "Custom Id cannot contain :". Bug real 2026-07-06:
 * `publish:${targetId}` en el primer intento tenia solo 2 partes y tumbaba
 * el primer intento de publicar/programar — los reintentos (3 partes, con
 * sufijo ":r{n}") no fallaban, lo que oculto el bug. `generate` ya tenia 3
 * partes por casualidad; `sync`/`metrics`/`tokenRefresh` con 2 partes solo
 * "funcionan" hoy porque siempre se usan con `repeat` (otro camino interno
 * de BullMQ) — para no dejar esa excepcion fragil, todos usan "_" en vez de
 * ":" como separador salvo donde ya cumplian la regla de 3 partes.
 */
export const jobIds = {
  sync: (orgId: string) => `sync_${orgId}`,
  generate: (propertyId: string, styleVariant: string) => `content.generate:${propertyId}:${styleVariant}`,
  publish: (targetId: string, attempt = 0) => `publish:${targetId}:r${attempt}`,
  metrics: (orgId: string) => `metrics_${orgId}`,
  tokenRefresh: (orgId: string) => `token_refresh_${orgId}`,
  cognitiveBuild: (propertyId: string) => `cognitive_build_${propertyId}`,
  cognitiveRebuild: (orgId: string) => `cognitive_rebuild_${orgId}`
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

/** Construccion del Property Context (DCE) para una propiedad — jobId determinista anti-duplicados. */
export async function enqueueCognitiveBuild(orgId: string, propertyId: string): Promise<void> {
  await getQueue(QUEUE_NAMES.cognitive).add(
    "build-context",
    { orgId, propertyId },
    { jobId: jobIds.cognitiveBuild(propertyId) }
  );
}

export function backoffForAttempt(attemptsMade: number): number {
  return PUBLISH_RETRY_BACKOFF_MS[Math.min(attemptsMade, PUBLISH_RETRY_BACKOFF_MS.length - 1)] ?? 0;
}
