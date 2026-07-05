import Fastify from "fastify";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { apiKeyAuth } from "./api/auth.js";
import { healthRoutes } from "./api/health.js";
import { syncRoutes } from "./api/sync.routes.js";
import { generationRoutes } from "./api/generation.routes.js";

export function buildServer() {
  const app = Fastify({
    loggerInstance: logger
  });

  app.addHook("onRequest", apiKeyAuth);

  app.register(healthRoutes);
  app.register(syncRoutes);
  app.register(generationRoutes);

  // Las rutas de negocio restantes (publications, connections, templates,
  // brand) se registran incrementalmente en los WP siguientes, cada una
  // detras del middleware apiKeyAuth ya instalado arriba.

  return app;
}
