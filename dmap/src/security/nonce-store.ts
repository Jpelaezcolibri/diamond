/**
 * Nonce de un solo uso para el state OAuth (CSRF, ver ARCHITECTURE.md #8/#14).
 * En memoria del proceso: suficiente mientras DMAP corre en una sola
 * instancia (Fase 1). Si en el futuro se escala horizontalmente, esto se
 * reemplaza por un SETNX en Redis con el mismo TTL — la firma de
 * consumeNonce() no cambiaria.
 */
const usedNonces = new Map<string, number>(); // nonce -> epoch de expiracion (segundos)

function prune(): void {
  const now = Math.floor(Date.now() / 1000);
  for (const [nonce, exp] of usedNonces) {
    if (exp < now) usedNonces.delete(nonce);
  }
}

/** true si el nonce era nuevo (se marca como usado); false si ya se habia consumido. */
export function consumeNonce(nonce: string, ttlSeconds: number): boolean {
  prune();
  if (usedNonces.has(nonce)) return false;
  usedNonces.set(nonce, Math.floor(Date.now() / 1000) + ttlSeconds);
  return true;
}
