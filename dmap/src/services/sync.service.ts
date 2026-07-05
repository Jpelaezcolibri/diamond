import { logger } from "../lib/logger.js";
import { diffPropertySnapshot, type PropertySnapshot } from "../sync/diff.js";
import { WasiApiSource } from "../sync/wasi-api.source.js";
import { WasiPublicSource } from "../sync/wasi-public.source.js";
import type { SyncCandidate, WasiSource } from "../sync/wasi-source.js";
import { getOrgMarketingSettings } from "../repositories/settings.repo.js";
import * as propertiesRepo from "../repositories/properties.repo.js";
import * as syncRepo from "../repositories/sync.repo.js";
import type { SyncRunRow } from "../repositories/types.js";

const sources: Record<SyncRunRow["source"], WasiSource> = {
  wasi_public: new WasiPublicSource(),
  wasi_api: new WasiApiSource()
};

export interface SyncStats {
  seen: number;
  created: number;
  updated: number;
  removed: number;
  errors: number;
}

/** Orquesta un ciclo de sincronizacion completo para una org — ver dmap/ARCHITECTURE.md #5. */
export async function runSync(orgId: string): Promise<{ syncRunId: string; stats: SyncStats }> {
  const settings = await getOrgMarketingSettings(orgId);
  const source = sources[settings.sync_source];
  const run = await syncRepo.startSyncRun(orgId, settings.sync_source);

  const stats: SyncStats = { seen: 0, created: 0, updated: 0, removed: 0, errors: 0 };
  try {
    const candidates = await source.fetchCandidates(orgId);
    stats.seen = candidates.length;

    for (const candidate of candidates) {
      try {
        await processCandidate(orgId, run.id, candidate, stats);
      } catch (err) {
        stats.errors += 1;
        logger.error({ err, ref: candidate.data?.ref }, "Error procesando candidato de sync");
      }
    }

    await syncRepo.finishSyncRun(run.id, "success", stats as unknown as SyncRunRow["stats"]);
  } catch (err) {
    await syncRepo.finishSyncRun(run.id, "failed", stats as unknown as SyncRunRow["stats"], (err as Error).message);
    throw err;
  }

  return { syncRunId: run.id, stats };
}

async function processCandidate(orgId: string, syncRunId: string, candidate: SyncCandidate, stats: SyncStats): Promise<void> {
  if (candidate.gone) {
    if (!candidate.propertyId) return;
    await propertiesRepo.updateProperty(candidate.propertyId, { disponible: false });
    await syncRepo.recordPropertyChangeEvent({
      org_id: orgId,
      property_id: candidate.propertyId,
      sync_run_id: syncRunId,
      change_type: "removed",
      old_value: { disponible: true },
      new_value: { disponible: false }
    });
    stats.removed += 1;
    return;
  }

  const data = candidate.data;
  if (!data) return;

  const isNew = candidate.propertyId === null;
  let propertyId: string;

  if (candidate.propertyId) {
    propertyId = candidate.propertyId;
  } else {
    const created = await propertiesRepo.createProperty({
      org_id: orgId,
      ref: data.ref,
      titulo: data.titulo ?? data.ref,
      tipo: data.tipo,
      operacion: data.operacion,
      precio: data.precio,
      area: data.area,
      habitaciones: data.habitaciones,
      banos: data.banos,
      garaje: null,
      estrato: null,
      administracion: null,
      zona: data.zona,
      ciudad: data.ciudad,
      descripcion: data.descripcion,
      caracteristicas: null,
      link: data.link,
      disponible: true,
      images: data.imageUrls
    });
    propertyId = created.id;
  }

  const snapshot: PropertySnapshot = {
    precio: data.precio,
    operacion: data.operacion,
    titulo: data.titulo,
    descripcion: data.descripcion,
    disponible: true,
    area: data.area,
    habitaciones: data.habitaciones,
    banos: data.banos,
    zona: data.zona,
    imageKeys: data.imageKeys
  };

  const previousState = isNew ? null : await syncRepo.getPropertySyncState(propertyId);
  const previous =
    previousState?.content_hash && previousState.raw
      ? {
          contentHash: previousState.content_hash,
          imagesHash: previousState.images_hash ?? "",
          snapshot: previousState.raw as unknown as PropertySnapshot
        }
      : null;

  const diff = diffPropertySnapshot(previous, snapshot);

  const patch: Record<string, unknown> = {};
  if (!isNew && previous === null) {
    // Primera sincronizacion de una propiedad que YA existia en la tabla
    // (ej. importada por Excel o el scraper viejo): la fila puede estar
    // desactualizada respecto a Wasi sin que el diff lo note (el diff compara
    // snapshots de la fuente, no la fila). Refresh completo de los campos
    // que el sync gobierna, para reconciliar la fila con la fuente.
    patch.titulo = data.titulo ?? data.ref;
    patch.tipo = data.tipo;
    patch.operacion = data.operacion;
    patch.precio = data.precio;
    patch.descripcion = data.descripcion;
    patch.area = data.area;
    patch.habitaciones = data.habitaciones;
    patch.banos = data.banos;
    patch.zona = data.zona;
    patch.ciudad = data.ciudad;
    patch.link = data.link;
    patch.disponible = true;
    if (data.imageUrls.length > 0) patch.images = data.imageUrls;
  }
  for (const event of diff.events) {
    if (event.changeType === "price_changed") patch.precio = data.precio;
    if (event.changeType === "status_changed") patch.disponible = snapshot.disponible;
    if (event.changeType === "description_changed") {
      patch.titulo = data.titulo;
      patch.descripcion = data.descripcion;
    }
    if (event.changeType === "photos_changed" && data.imageUrls.length > 0) patch.images = data.imageUrls;
  }
  if (!isNew && Object.keys(patch).length > 0) {
    await propertiesRepo.updateProperty(propertyId, patch);
  }

  await syncRepo.upsertPropertySyncState({
    property_id: propertyId,
    org_id: orgId,
    wasi_id: candidate.wasiId,
    content_hash: diff.contentHash,
    images_hash: diff.imagesHash,
    raw: snapshot as unknown as Record<string, unknown>
  });

  for (const event of diff.events) {
    await syncRepo.recordPropertyChangeEvent({
      org_id: orgId,
      property_id: propertyId,
      sync_run_id: syncRunId,
      change_type: event.changeType,
      old_value: event.oldValue,
      new_value: event.newValue
    });
  }

  if (diff.events.some((e) => e.changeType === "created")) stats.created += 1;
  else if (diff.events.length > 0) stats.updated += 1;
}
