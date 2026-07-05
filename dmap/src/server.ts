import Fastify from "fastify";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { apiKeyAuth } from "./api/auth.js";
import { healthRoutes } from "./api/health.js";
import { syncRoutes } from "./api/sync.routes.js";
import { generationRoutes } from "./api/generation.routes.js";
import { connectionsRoutes } from "./api/connections.routes.js";
import { publicationsRoutes } from "./api/publications.routes.js";
import { settingsRoutes } from "./api/settings.routes.js";

export function buildServer() {
  const app = Fastify({
    loggerInstance: logger
  });

  app.addHook("onRequest", apiKeyAuth);

  app.register(healthRoutes);
  app.register(syncRoutes);
  app.register(generationRoutes);
  app.register(connectionsRoutes);
  app.register(publicationsRoutes);
  app.register(settingsRoutes);

  // Las rutas restantes (templates, brand) se registran cuando el Brand
  // Studio (F2) las necesite, detras del middleware apiKeyAuth ya instalado.

  return app;
}
