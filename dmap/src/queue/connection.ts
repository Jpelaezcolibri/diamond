import type { ConnectionOptions } from "bullmq";
import { env } from "../config/env.js";

function parseRedisUrl(redisUrl: string) {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    tls: url.protocol === "rediss:" ? {} : undefined
  };
}

/**
 * Opciones de conexion (no un cliente compartido): cada Queue/Worker de
 * BullMQ crea su propio cliente ioredis internamente a partir de esto,
 * evitando el choque de tipos entre la version de ioredis que trae bullmq
 * y una instancia externa.
 */
export const redisConnectionOptions: ConnectionOptions = {
  ...parseRedisUrl(env.REDIS_URL),
  // Requerido por BullMQ para que los bloqueos de cola no fallen en reintentos.
  maxRetriesPerRequest: null,
  enableReadyCheck: false
};
