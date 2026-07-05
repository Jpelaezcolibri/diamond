import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { buildServer } from "./server.js";

async function main() {
  const app = buildServer();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Apagando dmap...");
    await app.close();
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
