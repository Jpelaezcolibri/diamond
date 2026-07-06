import { logger } from "../../lib/logger.js";
import { enqueueCognitiveBuild } from "../../queue/queues.js";
import { markContextStale } from "../repositories/property-context.repo.js";
import type { ChangeEvent } from "../../sync/diff.js";

/**
 * Cambios de propiedad que dejan obsoleto el Property Context. `status_changed`
 * (disponible si/no) NO invalida: la disponibilidad no cambia a quien le sirve
 * la propiedad ni como se cuenta — regenerar por eso seria costo por ruido.
 */
const SEMANTIC_CHANGE_TYPES = new Set(["price_changed", "description_changed", "photos_changed"]);

export function hasSemanticChange(events: ChangeEvent[]): boolean {
  return events.some((e) => SEMANTIC_CHANGE_TYPES.has(e.changeType));
}

/**
 * Hook del sync (politica aprobada por el usuario 2026-07-06): propiedad
 * nueva -> se encola la construccion del contexto de inmediato; cambio
 * semantico -> la fila queda 'stale' y el batch nocturno la regenera (o el
 * boton del CRM, si urge). Nunca tumba el sync: cualquier error aqui es un
 * warn — el contexto se reconcilia en el siguiente ciclo.
 */
export async function applyCognitiveInvalidation(orgId: string, propertyId: string, events: ChangeEvent[]): Promise<void> {
  try {
    if (events.some((e) => e.changeType === "created")) {
      await enqueueCognitiveBuild(orgId, propertyId);
      logger.info({ orgId, propertyId }, "DCE: contexto encolado para propiedad nueva");
      return;
    }
    if (hasSemanticChange(events)) {
      await markContextStale(orgId, propertyId);
      logger.info({ orgId, propertyId }, "DCE: contexto marcado stale por cambio semantico");
    }
  } catch (err) {
    logger.warn({ err, orgId, propertyId }, "DCE: fallo la invalidacion de contexto (el sync continua)");
  }
}
