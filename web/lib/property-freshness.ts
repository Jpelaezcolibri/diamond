const NEW_THRESHOLD_DAYS = 7;

/** true si la propiedad entro al inventario hace <= NEW_THRESHOLD_DAYS dias — dispara el badge "Nuevo". */
export function isNewProperty(createdAt: string, now: Date = new Date()): boolean {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return false;
  const diffMs = now.getTime() - created.getTime();
  return diffMs >= 0 && diffMs <= NEW_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
}
