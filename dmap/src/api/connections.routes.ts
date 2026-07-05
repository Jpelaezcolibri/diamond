import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  completeOAuthCallback,
  discoverAccounts,
  removeConnection,
  saveConnections,
  startConnection,
  validateConnection
} from "../services/connection.service.js";
import { listConnectionsByOrg } from "../repositories/social-connections.repo.js";
import type { SocialConnectionRow } from "../repositories/types.js";
import { env } from "../config/env.js";

/** Nunca exponer el token cifrado (ni ningun otro secreto) en una respuesta de API. */
function toPublicConnection(row: SocialConnectionRow) {
  const { access_token_enc: _accessTokenEnc, ...rest } = row;
  return rest;
}

const startBodySchema = z.object({ orgId: z.string().uuid(), returnUrl: z.string().url() });
const connectionsBodySchema = z.object({
  orgId: z.string().uuid(),
  selections: z
    .array(z.object({ platform: z.enum(["facebook", "instagram"]), externalAccountId: z.string() }))
    .min(1)
});

export async function connectionsRoutes(app: FastifyInstance) {
  app.post("/api/v1/meta/oauth/start", async (request, reply) => {
    const parsed = startBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
      return;
    }
    const { url } = startConnection(parsed.data.orgId, parsed.data.returnUrl);
    reply.send({ url });
  });

  app.get("/api/v1/meta/oauth/callback", async (request, reply) => {
    const query = z
      .object({
        code: z.string().optional(),
        state: z.string().optional(),
        // Meta redirige con estos parametros cuando el dialogo falla o el
        // usuario cancela (ej. error 100 "Invalid Scopes" en apps Business).
        error: z.string().optional(),
        error_code: z.string().optional(),
        error_message: z.string().optional(),
        error_description: z.string().optional()
      })
      .safeParse(request.query);

    const q = query.success ? query.data : {};
    if (!q.code || !q.state || q.error || q.error_code) {
      const reason = q.error_message ?? q.error_description ?? q.error ?? "callback_incompleto";
      request.log.error({ error: q.error, errorCode: q.error_code, reason }, "Meta devolvio error en el callback de OAuth");
      reply.redirect(`${env.CRM_URL}/marketing/configuracion?connect=error&reason=${encodeURIComponent(reason.slice(0, 200))}`);
      return;
    }

    try {
      const { returnUrl } = await completeOAuthCallback(q.state, q.code);
      const separator = returnUrl.includes("?") ? "&" : "?";
      reply.redirect(`${returnUrl}${separator}connect=ok`);
    } catch (err) {
      request.log.error({ err }, "Fallo el callback de OAuth de Meta");
      reply.redirect(`${env.CRM_URL}/marketing/configuracion?connect=error`);
    }
  });

  app.get("/api/v1/meta/accounts", async (request, reply) => {
    const orgId = (request.query as { orgId?: string }).orgId;
    if (!orgId) {
      reply.code(400).send({ error: "orgId es requerido" });
      return;
    }
    try {
      const accounts = await discoverAccounts(orgId);
      reply.send({ accounts });
    } catch (err) {
      reply.code(502).send({ error: "discover_failed", message: (err as Error).message });
    }
  });

  app.post("/api/v1/meta/connections", async (request, reply) => {
    const parsed = connectionsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
      return;
    }
    const actorId = request.headers["x-actor-id"];
    const connectedBy = typeof actorId === "string" && actorId.length > 0 ? actorId : undefined;
    try {
      const saved = await saveConnections(parsed.data.orgId, parsed.data.selections, connectedBy);
      reply.code(201).send({ connections: saved.map(toPublicConnection) });
    } catch (err) {
      reply.code(502).send({ error: "save_connections_failed", message: (err as Error).message });
    }
  });

  app.get("/api/v1/connections", async (request, reply) => {
    const orgId = (request.query as { orgId?: string }).orgId;
    if (!orgId) {
      reply.code(400).send({ error: "orgId es requerido" });
      return;
    }
    const connections = await listConnectionsByOrg(orgId);
    reply.send({ connections: connections.map(toPublicConnection) });
  });

  app.delete("/api/v1/connections/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) {
      reply.code(400).send({ error: "invalid_id" });
      return;
    }
    await removeConnection(params.data.id);
    reply.code(204).send();
  });

  app.post("/api/v1/connections/:id/validate", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) {
      reply.code(400).send({ error: "invalid_id" });
      return;
    }
    const status = await validateConnection(params.data.id);
    reply.send({ status });
  });
}
