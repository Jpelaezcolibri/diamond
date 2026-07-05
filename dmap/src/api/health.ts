import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    return { status: "ok", service: "dmap", timestamp: new Date().toISOString() };
  });

  app.get("/metrics", async () => {
    // WP9 ampliara esto con contadores reales de colas y publicaciones.
    return {
      service: "dmap",
      uptime_seconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString()
    };
  });
}
