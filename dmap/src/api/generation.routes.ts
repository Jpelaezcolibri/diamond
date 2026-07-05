import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { generateDraftForProperty } from "../services/generation.service.js";
import { STYLE_VARIANTS } from "../config/constants.js";

const generateBodySchema = z.object({
  orgId: z.string().uuid(),
  styleVariant: z.enum(STYLE_VARIANTS)
});

export async function generationRoutes(app: FastifyInstance) {
  app.post("/api/v1/generation/property/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = generateBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      reply.code(400).send({ error: "invalid_request", issues: [...(params.error?.issues ?? []), ...(body.error?.issues ?? [])] });
      return;
    }

    const actorId = request.headers["x-actor-id"];
    const actor = typeof actorId === "string" && actorId.length > 0 ? `user:${actorId}` : "system:api";

    try {
      const result = await generateDraftForProperty(body.data.orgId, params.data.id, body.data.styleVariant, actor);
      reply.code(201).send(result);
    } catch (err) {
      request.log.error({ err, propertyId: params.data.id }, "Fallo la generacion de contenido");
      reply.code(502).send({ error: "generation_failed", message: (err as Error).message });
    }
  });
}
