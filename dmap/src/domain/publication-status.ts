/**
 * State machine de publicaciones — ver dmap/ARCHITECTURE.md #4.6.
 * publication.service.transition() es el UNICO escritor de este campo.
 */
export const PUBLICATION_STATUSES = [
  "draft",
  "approved",
  "scheduled",
  "publishing",
  "published",
  "partially_published",
  "failed",
  "archived"
] as const;

export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

/** Aristas validas del grafo. draft -> draft representa "editar/regenerar sin salir de borrador". */
export const VALID_TRANSITIONS: Record<PublicationStatus, readonly PublicationStatus[]> = {
  draft: ["draft", "approved", "archived"],
  approved: ["scheduled", "publishing", "archived"],
  scheduled: ["publishing", "archived"],
  publishing: ["published", "partially_published", "failed"],
  failed: ["publishing", "archived"],
  partially_published: ["publishing", "archived"],
  published: [],
  archived: []
};

export function canTransition(from: PublicationStatus, to: PublicationStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export const PUBLICATION_STATUS_LABELS_ES: Record<PublicationStatus, string> = {
  draft: "Generado",
  approved: "Aprobado",
  scheduled: "Programado",
  publishing: "Publicando",
  published: "Publicado",
  partially_published: "Publicado parcial",
  failed: "Error",
  archived: "Archivado"
};

export const PUBLICATION_TARGET_STATUSES = ["pending", "publishing", "published", "failed"] as const;
export type PublicationTargetStatus = (typeof PUBLICATION_TARGET_STATUSES)[number];

/**
 * Deriva el status de la publicacion a partir del conjunto de sus targets,
 * una vez que el envio a todas las plataformas termino (ninguno pending/publishing).
 */
export function deriveStatusFromTargets(targetStatuses: PublicationTargetStatus[]): PublicationStatus {
  if (targetStatuses.length === 0) {
    throw new Error("No se puede derivar el estado de una publicacion sin targets");
  }
  const stillRunning = targetStatuses.some((s) => s === "pending" || s === "publishing");
  if (stillRunning) {
    return "publishing";
  }
  const allPublished = targetStatuses.every((s) => s === "published");
  const allFailed = targetStatuses.every((s) => s === "failed");
  if (allPublished) return "published";
  if (allFailed) return "failed";
  return "partially_published";
}
