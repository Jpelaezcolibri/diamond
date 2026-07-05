import Fastify from "fastify";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { apiKeyAuth } from "./api/auth.js";
import { healthRoutes } from "./api/health.js";

export function buildServer() {
  const app = Fastify({
    loggerInstance: logger
  });

  app.addHook("onRequest", apiKeyAuth);

  app.register(healthRoutes);

  // Las rutas de negocio (publications, generation, connections, sync,
  // templates, brand) se registran incrementalmente en los WP siguientes,
  // cada una detras del middleware apiKeyAuth ya instalado arriba.

  return app;
}
