import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { runSync } from "../services/sync.service.js";
import { getSupabase } from "../repositories/supabase.js";
import { getQueue, QUEUE_NAMES } from "../queue/queues.js";

const runBodySchema = z.object({ orgId: z.string().uuid() });

export async function syncRoutes(app: FastifyInstance) {
  app.post("/api/v1/sync/run", async (request, reply) => {
    const parsed = runBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
      return;
    }
    try {
      const result = await runSync(parsed.data.orgId);
      reply.send(result);
    } catch (err) {
      request.log.error({ err }, "Fallo la sincronizacion manual");
      reply.code(502).send({ error: "sync_failed", message: (err as Error).message });
    }
  });

  app.get("/api/v1/sync/runs", async (request, reply) => {
    const orgId = (request.query as { orgId?: string }).orgId;
    if (!orgId) {
      reply.code(400).send({ error: "orgId es requerido" });
      return;
    }
    const { data, error } = await getSupabase()
      .from("sync_runs")
      .select()
      .eq("org_id", orgId)
      .order("started_at", { ascending: false })
      .limit(20);
    if (error) {
      reply.code(500).send({ error: error.message });
      return;
    }
    reply.send({ runs: data });
  });

  /** Diagnostico: cadencia real registrada en BullMQ (ver schedules.ts sobre repeatables huerfanos/duplicados). */
  app.get("/api/v1/sync/schedules", async (_request, reply) => {
    const repeatables = await getQueue(QUEUE_NAMES.sync).getRepeatableJobs();
    reply.send({
      schedules: repeatables.map((r) => ({
        id: r.id,
        everyMs: r.every,
        everyMinutes: r.every ? Number(r.every) / 60_000 : null,
        next: r.next ? new Date(r.next).toISOString() : null
      }))
    });
  });
}
