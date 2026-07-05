// ---------------------------------------------------------------------------
// Rate limit best-effort en memoria (ventana deslizante por clave/IP).
//
// LIMITACION conocida: en Vercel serverless cada instancia tiene su propio
// mapa, así que el límite es POR INSTANCIA, no global. Frena abuso casual y
// sube el costo de spamear, pero no es una defensa dura. Para protección real
// a escala, cambiar el store por @vercel/kv o Upstash Redis (misma interfaz).
// ---------------------------------------------------------------------------

type Hit = { count: number; resetAt: number };

const store = new Map<string, Hit>();

// Poda perezosa para que el Map no crezca sin límite.
function sweep(now: number) {
  if (store.size < 5000) return;
  for (const [key, hit] of store) {
    if (hit.resetAt <= now) store.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * @param key      identificador (ej. `leads:<ip>`)
 * @param limit    máximo de eventos por ventana
 * @param windowMs tamaño de la ventana en ms
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const hit = store.get(key);
  if (!hit || hit.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSec: 0 };
  }

  if (hit.count >= limit) {
    return { ok: false, remaining: 0, retryAfterSec: Math.ceil((hit.resetAt - now) / 1000) };
  }

  hit.count += 1;
  return { ok: true, remaining: limit - hit.count, retryAfterSec: 0 };
}

/** Extrae la IP del cliente de los headers de Vercel/proxy. */
export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
