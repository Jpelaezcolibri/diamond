import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildPropertyContext } from "../application/context-builder.service.js";
import { getContextByRef, listContextPropertyIds } from "../repositories/property-context.repo.js";
import { getPropertyByRef, listPropertiesByOrg } from "../../repositories/properties.repo.js";
import { enqueueCognitiveBuild } from "../../queue/queues.js";

const orgQuerySchema = z.object({ orgId: z.string().uuid() });

/**
 * API del Diamond Cognitive Engine (consumida SOLO por el proxy del CRM con
 * X-API-Key, como el resto de dmap). Los demas modulos NO usan esta API:
 * leen property_contexts directo de Supabase.
 */
export async function cognitiveRoutes(app: FastifyInstance) {
  // Estado/contenido del contexto de una propiedad (por ref, que es lo que ve el humano).
  app.get("/api/v1/cognitive/context/:ref", async (request, reply) => {
    const params = z.object({ ref: z.string().min(1) }).safeParse(request.params);
    const query = orgQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      reply.code(400).send({ error: "invalid_request" });
      return;
    }
    const row = await getContextByRef(query.data.orgId, params.data.ref);
    if (!row) {
      reply.code(404).send({ error: "context_not_found" });
      return;
    }
    reply.send(row);
  });

  // Regeneracion manual (boton del CRM). Sincrona a proposito: son ~2
  // llamadas Claude (20-60s), mismo patron que POST /generation/property.
  app.post("/api/v1/cognitive/context/:ref/regenerate", async (request, reply) => {
    const params = z.object({ ref: z.string().min(1) }).safeParse(request.params);
    const body = orgQuerySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      reply.code(400).send({ error: "invalid_request" });
      return;
    }

    const property = await getPropertyByRef(body.data.orgId, params.data.ref);
    if (!property) {
      reply.code(404).send({ error: "property_not_found" });
      return;
    }

    try {
      const row = await buildPropertyContext(body.data.orgId, property.id);
      reply.code(201).send(row);
    } catch (err) {
      request.log.error({ err, ref: params.data.ref }, "Fallo la generacion del Property Context");
      reply.code(502).send({ error: "context_generation_failed", message: (err as Error).message });
    }
  });

  // Backfill: encola la construccion del contexto de todas las propiedades
  // disponibles de la org que aun no tienen fila (rollout inicial del DCE).
  // Asincrono via cola — 39+ propiedades x 2 llamadas Claude no caben en un request.
  app.post("/api/v1/cognitive/backfill", async (request, reply) => {
    const body = orgQuerySchema.safeParse(request.body);
    if (!body.success) {
      reply.code(400).send({ error: "invalid_request" });
      return;
    }

    const [properties, withContext] = await Promise.all([
      listPropertiesByOrg(body.data.orgId),
      listContextPropertyIds(body.data.orgId)
    ]);
    const missing = properties.filter((p) => p.disponible && !withContext.has(p.id));

    try {
      for (const property of missing) {
        await enqueueCognitiveBuild(body.data.orgId, property.id);
      }
    } catch (err) {
      request.log.error({ err }, "Backfill cognitivo: no se pudo encolar (¿Redis no disponible?)");
      reply.code(503).send({ error: "queue_unavailable", message: (err as Error).message });
      return;
    }

    reply.code(202).send({ enqueued: missing.length, alreadyBuilt: withContext.size });
  });
}
