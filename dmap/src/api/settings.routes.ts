import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getOrgMarketingSettings, updateOrgMarketingSettings } from "../repositories/settings.repo.js";
import { encryptSecret } from "../security/crypto.js";
import { reconcileSyncSchedules } from "../scheduler/schedules.js";

/** Nunca devolver wasi_id_company_enc/wasi_token_enc — solo si hay credenciales guardadas o no. */
function toPublicSettings(settings: Awaited<ReturnType<typeof getOrgMarketingSettings>>) {
  const { wasi_id_company_enc, wasi_token_enc, ...rest } = settings;
  return { ...rest, hasWasiCredentials: Boolean(wasi_id_company_enc && wasi_token_enc) };
}

const updateBodySchema = z.object({
  autoGenerateOnNewProperty: z.boolean().optional(),
  autoGenerateOnPhotoChange: z.boolean().optional(),
  publishWindow: z.object({ days: z.array(z.number().int().min(1).max(7)), from: z.string(), to: z.string() }).optional(),
  timezone: z.string().optional(),
  syncSource: z.enum(["wasi_api", "wasi_public"]).optional(),
  syncIntervalMinutes: z.number().int().positive().optional(),
  creativeEngine: z.enum(["ai", "template", "hybrid", "designer"]).optional(),
  // Credenciales de la API oficial de Wasi (id_company + wasi_token) — se
  // cifran aqui mismo, en texto plano solo llegan por HTTPS y nunca se
  // guardan sin cifrar ni se devuelven en ninguna respuesta.
  wasiIdCompany: z.string().min(1).optional(),
  wasiToken: z.string().min(1).optional()
});

export async function settingsRoutes(app: FastifyInstance) {
  app.get("/api/v1/settings", async (request, reply) => {
    const orgId = (request.query as { orgId?: string }).orgId;
    if (!orgId) {
      reply.code(400).send({ error: "orgId es requerido" });
      return;
    }
    try {
      const settings = await getOrgMarketingSettings(orgId);
      reply.send(toPublicSettings(settings));
    } catch (err) {
      reply.code(502).send({ error: "settings_read_failed", message: (err as Error).message });
    }
  });

  app.put("/api/v1/settings", async (request, reply) => {
    const orgId = (request.query as { orgId?: string }).orgId;
    const body = updateBodySchema.safeParse(request.body);
    if (!orgId || !body.success) {
      reply.code(400).send({ error: "invalid_request", issues: body.error?.issues ?? [] });
      return;
    }
    try {
      const { wasiIdCompany, wasiToken, ...rest } = body.data;
      await updateOrgMarketingSettings(orgId, {
        ...(rest.autoGenerateOnNewProperty !== undefined && { auto_generate_on_new_property: rest.autoGenerateOnNewProperty }),
        ...(rest.autoGenerateOnPhotoChange !== undefined && { auto_generate_on_photo_change: rest.autoGenerateOnPhotoChange }),
        ...(rest.publishWindow && { publish_window: rest.publishWindow }),
        ...(rest.timezone && { timezone: rest.timezone }),
        ...(rest.syncSource && { sync_source: rest.syncSource }),
        ...(rest.syncIntervalMinutes && { sync_interval_minutes: rest.syncIntervalMinutes }),
        ...(rest.creativeEngine && { creative_engine: rest.creativeEngine }),
        ...(wasiIdCompany && { wasi_id_company_enc: encryptSecret(wasiIdCompany) }),
        ...(wasiToken && { wasi_token_enc: encryptSecret(wasiToken) })
      });
      // Sin esto, un cambio de "cada cuantos minutos" desde el CRM se guarda
      // en la DB pero el repeatable de BullMQ sigue con el intervalo viejo
      // hasta el proximo reinicio del servicio (reconcileSyncSchedules solo
      // corria al boot) — bug real reportado por el usuario (2026-07-05).
      if (rest.syncIntervalMinutes !== undefined) {
        await reconcileSyncSchedules();
      }
      const updated = await getOrgMarketingSettings(orgId);
      reply.send(toPublicSettings(updated));
    } catch (err) {
      reply.code(502).send({ error: "settings_update_failed", message: (err as Error).message });
    }
  });
}
