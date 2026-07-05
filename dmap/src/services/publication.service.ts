import { FatalError } from "../lib/errors.js";
import { canTransition, type PublicationStatus } from "../domain/publication-status.js";
import { getPublicationById, updatePublicationStatus } from "../repositories/publications.repo.js";
import { recordPublicationEvent, type RecordEventInput } from "../repositories/publication-events.repo.js";

export interface PublicationStatusPort {
  getStatus(id: string): Promise<PublicationStatus | null>;
  updateStatus(id: string, status: PublicationStatus, extra?: Record<string, unknown>): Promise<void>;
}

export interface PublicationEventsPort {
  record(input: RecordEventInput): Promise<void>;
}

const defaultStatusPort: PublicationStatusPort = {
  async getStatus(id) {
    const pub = await getPublicationById(id);
    return pub?.status ?? null;
  },
  async updateStatus(id, status, extra) {
    await updatePublicationStatus(id, status, extra);
  }
};

const defaultEventsPort: PublicationEventsPort = {
  record: recordPublicationEvent
};

/**
 * Unico escritor de publications.status (ver dmap/ARCHITECTURE.md #4.6).
 * Ningun worker ni endpoint debe hacer UPDATE directo sobre esa columna:
 * siempre pasan por transition(), que valida la arista y deja auditoria.
 */
export class PublicationService {
  constructor(
    private readonly statusPort: PublicationStatusPort = defaultStatusPort,
    private readonly eventsPort: PublicationEventsPort = defaultEventsPort
  ) {}

  async transition(
    publicationId: string,
    orgId: string,
    to: PublicationStatus,
    actor: string,
    detail?: Record<string, unknown>,
    extra?: Record<string, unknown>
  ): Promise<{ from: PublicationStatus; to: PublicationStatus }> {
    const from = await this.statusPort.getStatus(publicationId);
    if (from === null) {
      throw new FatalError(`Publicacion ${publicationId} no existe`);
    }
    if (!canTransition(from, to)) {
      throw new FatalError(`Transicion invalida: ${from} -> ${to} (publicacion ${publicationId})`);
    }

    await this.statusPort.updateStatus(publicationId, to, extra);
    await this.eventsPort.record({
      publication_id: publicationId,
      org_id: orgId,
      from_status: from,
      to_status: to,
      actor,
      detail
    });

    return { from, to };
  }
}

export const publicationService = new PublicationService();
