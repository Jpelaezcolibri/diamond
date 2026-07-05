import { computeContentHash, computeImagesHash, type HashableContent } from "./hash.js";
import type { PropertyChangeType } from "../repositories/types.js";

export interface PropertySnapshot extends HashableContent {
  imageKeys: string[];
}

export interface PreviousState {
  contentHash: string;
  imagesHash: string;
  snapshot: PropertySnapshot;
}

export interface ChangeEvent {
  changeType: PropertyChangeType;
  oldValue: unknown;
  newValue: unknown;
}

export interface DiffResult {
  contentHash: string;
  imagesHash: string;
  events: ChangeEvent[];
}

/**
 * Compara el snapshot actual de una propiedad contra su estado guardado en
 * property_sync_state y produce los eventos de cambio tipados que dispararan
 * (o no) generacion de contenido — ver dmap/ARCHITECTURE.md #5.
 *
 * `previous === null` significa que la propiedad es nueva para DMAP (evento
 * 'created'). El caso "removed" (la propiedad desaparecio de la fuente) se
 * maneja aparte en sync.service, porque ahi no hay un snapshot actual que comparar.
 */
export function diffPropertySnapshot(previous: PreviousState | null, current: PropertySnapshot): DiffResult {
  const contentHash = computeContentHash(current);
  const imagesHash = computeImagesHash(current.imageKeys);

  if (previous === null) {
    return {
      contentHash,
      imagesHash,
      events: [{ changeType: "created", oldValue: null, newValue: current }]
    };
  }

  const events: ChangeEvent[] = [];
  const prev = previous.snapshot;

  if (prev.disponible !== current.disponible) {
    events.push({ changeType: "status_changed", oldValue: prev.disponible, newValue: current.disponible });
  }

  if (previous.contentHash !== contentHash) {
    if (prev.precio !== current.precio) {
      events.push({ changeType: "price_changed", oldValue: prev.precio, newValue: current.precio });
    }
    if (prev.titulo !== current.titulo || prev.descripcion !== current.descripcion) {
      events.push({
        changeType: "description_changed",
        oldValue: { titulo: prev.titulo, descripcion: prev.descripcion },
        newValue: { titulo: current.titulo, descripcion: current.descripcion }
      });
    }
  }

  if (previous.imagesHash !== imagesHash) {
    events.push({ changeType: "photos_changed", oldValue: prev.imageKeys, newValue: current.imageKeys });
  }

  return { contentHash, imagesHash, events };
}
