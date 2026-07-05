import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { buildServer } from "./server.js";
import { startSyncWorker } from "./queue/workers/sync.worker.js";
import { startTokenRefreshWorker } from "./queue/workers/token-refresh.worker.js";
import { startPublishWorker } from "./queue/workers/publish.worker.js";
import { startMetricsWorker } from "./queue/workers/metrics.worker.js";
import { reconcileSyncSchedules, reconcileTokenRefreshSchedules, reconcileMetricsSchedules } from "./scheduler/schedules.js";

async function main() {
  const app = buildServer();

  // La cola/scheduler dependen de Redis (addon de Railway). Si no esta
  // disponible (ej. desarrollo local sin Redis) el API sigue funcionando;
  // solo se pierde el procesamiento en background — mismo principio de
  // degradacion elegante que el bot en modo DEMO sin Supabase.
  let syncWorker: Awaited<ReturnType<typeof startSyncWorker>> | null = null;
  let tokenRefreshWorker: Awaited<ReturnType<typeof startTokenRefreshWorker>> | null = null;
  let publishWorker: Awaited<ReturnType<typeof startPublishWorker>> | null = null;
  let metricsWorker: Awaited<ReturnType<typeof startMetricsWorker>> | null = null;
  try {
    syncWorker = startSyncWorker();
    tokenRefreshWorker = startTokenRefreshWorker();
    publishWorker = startPublishWorker();
    metricsWorker = startMetricsWorker();
    await reconcileSyncSchedules();
    await reconcileTokenRefreshSchedules();
    await reconcileMetricsSchedules();
    logger.info("Colas y schedulers inicializados (sync, token-refresh, publish, metrics)");
  } catch (err) {
    logger.warn({ err }, "No se pudieron inicializar las colas (¿Redis no disponible?) — el API sigue activo");
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Apagando dmap...");
    await app.close();
    if (syncWorker) await syncWorker.close();
    if (tokenRefreshWorker) await tokenRefreshWorker.close();
    if (publishWorker) await publishWorker.close();
    if (metricsWorker) await metricsWorker.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    logger.info({ port: env.PORT, env: env.NODE_ENV }, "dmap escuchando");
  } catch (err) {
    logger.error({ err }, "dmap no pudo arrancar");
    process.exit(1);
  }
}

void main();
