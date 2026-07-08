import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { publicationService } from "../services/publication.service.js";
import { getPublicationById, schedulePublication, updatePublicationContent } from "../repositories/publications.repo.js";
import {
  createPublicationTargets,
  listTargetsByPublication
} from "../repositories/publication-targets.repo.js";
import { getConnectionById } from "../repositories/social-connections.repo.js";
import { enqueuePublish } from "../queue/queues.js";
import { FatalError } from "../lib/errors.js";
import { listCoverCandidates, regenerateCopyForPublication, regenerateCreativeForPublication } from "../services/generation.service.js";
import { STYLE_VARIANTS } from "../config/constants.js";

function actorFromRequest(request: { headers: Record<string, unknown> }): string {
  const actorId = request.headers["x-actor-id"];
  return typeof actorId === "string" && actorId.length > 0 ? `user:${actorId}` : "user:desconocido";
}

async function buildPlatformByConnection(connectionIds: string[]): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const connectionId of connectionIds) {
    const connection = await getConnectionById(connectionId);
    if (!connection) throw new FatalError(`Conexion ${connectionId} no existe`);
    map[connectionId] = connection.platform;
  }
  return map;
}

const scheduleBodySchema = z.object({
  scheduledAt: z.string().datetime(),
  connectionIds: z.array(z.string().uuid()).min(1),
  timezone: z.string().default("America/Bogota")
});

const publishNowBodySchema = z.object({
  connectionIds: z.array(z.string().uuid()).min(1)
});

const updateContentBodySchema = z.object({
  copyFacebook: z.string().min(1).optional(),
  copyInstagram: z.string().min(1).optional(),
  tituloComercial: z.string().min(1).optional(),
  descripcionComercial: z.string().min(1).optional(),
  metaTitle: z.string().min(1).optional(),
  metaDescription: z.string().min(1).optional(),
  hashtags: z.array(z.string()).optional(),
  cta: z.string().min(1).optional()
});

const regenerateBodySchema = z.object({ styleVariant: z.enum(STYLE_VARIANTS) });
const regenerateCreativeBodySchema = z
  .object({
    role: z.enum(["cover", "story"]),
    notes: z.string().trim().max(2000, "Las notas no pueden superar 2000 caracteres").optional(),
    // Instrucciones de mejora del critico IA de la corrida anterior — el CRM
    // las reenvia tal cual con el boton "corregir con las recomendaciones".
    criticInstructions: z.array(z.string().trim().min(1).max(600)).max(12).optional(),
    // Foto real elegida a mano por el humano (boton "elegir otra foto") —
    // reemplaza la que el ranking automatico puso por defecto.
    sourceImageUrl: z.string().trim().url().optional()
  })
  .refine((b) => (b.notes && b.notes.length > 0) || (b.criticInstructions && b.criticInstructions.length > 0) || b.sourceImageUrl, {
    message: "Escribe los cambios que quieres, envia las instrucciones del critico, o elegi otra foto"
  });

const coverCandidatesQuerySchema = z.object({ role: z.enum(["cover", "story"]).default("cover") });

export async function publicationsRoutes(app: FastifyInstance) {
  app.patch("/api/v1/publications/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = updateContentBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      reply.code(400).send({ error: "invalid_request", issues: [...(params.error?.issues ?? []), ...(body.error?.issues ?? [])] });
      return;
    }
    try {
      const publication = await getPublicationById(params.data.id);
      if (!publication) {
        reply.code(404).send({ error: "not_found" });
        return;
      }
      if (publication.status !== "draft") {
        reply.code(409).send({ error: "not_editable", message: "Solo se puede editar una publicacion en 'draft'" });
        return;
      }
      await updatePublicationContent(publication.id, {
        copy_facebook: body.data.copyFacebook,
        copy_instagram: body.data.copyInstagram,
        titulo_comercial: body.data.tituloComercial,
        descripcion_comercial: body.data.descripcionComercial,
        meta_title: body.data.metaTitle,
        meta_description: body.data.metaDescription,
        hashtags: body.data.hashtags,
        cta: body.data.cta
      });
      reply.send({ ok: true });
    } catch (err) {
      reply.code(502).send({ error: "update_failed", message: (err as Error).message });
    }
  });

  app.post("/api/v1/publications/:id/regenerate", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = regenerateBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      reply.code(400).send({ error: "invalid_request", issues: [...(params.error?.issues ?? []), ...(body.error?.issues ?? [])] });
      return;
    }
    try {
      await regenerateCopyForPublication(params.data.id, body.data.styleVariant);
      reply.send({ ok: true });
    } catch (err) {
      reply.code(502).send({ error: "regenerate_failed", message: (err as Error).message });
    }
  });

  // Regenerar el CREATIVO (imagen) con notas del humano — motor IA sobre la
  // misma foto, inyectando las instrucciones con prioridad. Puede tardar
  // 1-2 min (GPT Image + critico x hasta 2 rondas).
  app.post("/api/v1/publications/:id/regenerate-creative", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = regenerateCreativeBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      reply.code(400).send({ error: "invalid_request", issues: [...(params.error?.issues ?? []), ...(body.error?.issues ?? [])] });
      return;
    }
    try {
      const result = await regenerateCreativeForPublication(
        params.data.id,
        body.data.role,
        body.data.notes ?? "",
        actorFromRequest(request),
        {},
        body.data.criticInstructions ?? [],
        body.data.sourceImageUrl
      );
      reply.send(result);
    } catch (err) {
      reply.code(502).send({ error: "regenerate_creative_failed", message: (err as Error).message });
    }
  });

  // Candidatas para elegir a mano la foto fuente de un rol (Content Studio,
  // boton "elegir otra foto"): reusa el ranking determinista ya cacheado.
  app.get("/api/v1/publications/:id/cover-candidates", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const query = coverCandidatesQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      reply.code(400).send({ error: "invalid_request", issues: [...(params.error?.issues ?? []), ...(query.error?.issues ?? [])] });
      return;
    }
    try {
      const candidates = await listCoverCandidates(params.data.id, query.data.role);
      reply.send({ candidates });
    } catch (err) {
      reply.code(502).send({ error: "cover_candidates_failed", message: (err as Error).message });
    }
  });

  app.post("/api/v1/publications/:id/approve", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) {
      reply.code(400).send({ error: "invalid_id" });
      return;
    }
    try {
      const publication = await getPublicationById(params.data.id);
      if (!publication) {
        reply.code(404).send({ error: "not_found" });
        return;
      }
      await publicationService.transition(publication.id, publication.org_id, "approved", actorFromRequest(request));
      reply.send({ status: "approved" });
    } catch (err) {
      reply.code(409).send({ error: "approve_failed", message: (err as Error).message });
    }
  });

  /**
   * Descartar un borrador (draft -> archived, ver domain/publication-status.ts):
   * el Content Studio no ofrecia forma de "empezar de nuevo" para una propiedad
   * con un draft ya generado — archivar la libera para volver a aparecer como
   * "Sin publicar" en /marketing/publicaciones (esa query filtra status
   * archived) y poder generar un draft fresco con el selector/critico
   * actualizados. Solo valido en 'draft': aprobado/programado/publicado no se
   * descartan por accidente desde este boton.
   */
  app.post("/api/v1/publications/:id/archive", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) {
      reply.code(400).send({ error: "invalid_id" });
      return;
    }
    try {
      const publication = await getPublicationById(params.data.id);
      if (!publication) {
        reply.code(404).send({ error: "not_found" });
        return;
      }
      if (publication.status !== "draft") {
        reply.code(409).send({ error: "not_a_draft", message: `Solo se puede descartar un borrador (estado actual: '${publication.status}')` });
        return;
      }
      await publicationService.transition(publication.id, publication.org_id, "archived", actorFromRequest(request));
      reply.send({ status: "archived" });
    } catch (err) {
      reply.code(409).send({ error: "archive_failed", message: (err as Error).message });
    }
  });

  app.post("/api/v1/publications/:id/schedule", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = scheduleBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      reply.code(400).send({ error: "invalid_request", issues: [...(params.error?.issues ?? []), ...(body.error?.issues ?? [])] });
      return;
    }
    try {
      const publication = await getPublicationById(params.data.id);
      if (!publication) {
        reply.code(404).send({ error: "not_found" });
        return;
      }

      const platformByConnection = await buildPlatformByConnection(body.data.connectionIds);
      await schedulePublication(publication.id, body.data.scheduledAt, body.data.timezone);
      await publicationService.transition(publication.id, publication.org_id, "scheduled", actorFromRequest(request));

      const targets = await createPublicationTargets(publication.id, body.data.connectionIds, platformByConnection);
      const delayMs = Math.max(0, new Date(body.data.scheduledAt).getTime() - Date.now());
      for (const target of targets) {
        await enqueuePublish(target.id, delayMs);
      }

      reply.send({ status: "scheduled", targets: targets.length });
    } catch (err) {
      reply.code(409).send({ error: "schedule_failed", message: (err as Error).message });
    }
  });

  app.post("/api/v1/publications/:id/publish-now", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = publishNowBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      reply.code(400).send({ error: "invalid_request", issues: [...(params.error?.issues ?? []), ...(body.error?.issues ?? [])] });
      return;
    }
    try {
      const publication = await getPublicationById(params.data.id);
      if (!publication || publication.status !== "approved") {
        reply.code(409).send({ error: "publication_not_approved" });
        return;
      }

      const platformByConnection = await buildPlatformByConnection(body.data.connectionIds);
      const targets = await createPublicationTargets(publication.id, body.data.connectionIds, platformByConnection);
      for (const target of targets) {
        await enqueuePublish(target.id, 0);
      }
      reply.send({ status: "publishing", targets: targets.length });
    } catch (err) {
      reply.code(502).send({ error: "publish_failed", message: (err as Error).message });
    }
  });

  app.post("/api/v1/publications/:id/retry", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) {
      reply.code(400).send({ error: "invalid_id" });
      return;
    }
    try {
      const publication = await getPublicationById(params.data.id);
      if (!publication) {
        reply.code(404).send({ error: "not_found" });
        return;
      }
      const targets = await listTargetsByPublication(publication.id);
      const failedTargets = targets.filter((t) => t.status === "failed");
      for (const target of failedTargets) {
        await enqueuePublish(target.id, 0, target.attempts);
      }
      reply.send({ retried: failedTargets.length });
    } catch (err) {
      reply.code(502).send({ error: "retry_failed", message: (err as Error).message });
    }
  });
}
