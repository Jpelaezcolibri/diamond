// Cliente HTTP hacia DMAP (Diamond Growth Engine) — mismo patron que BOT_API_URL/BOT_API_KEY
// para el bot (ver crm/app/api/send/route.ts). Server-only: la API key nunca llega al navegador.

export async function dmapFetch(
  path: string,
  init: (RequestInit & { actorId?: string }) | undefined = {}
): Promise<Response | null> {
  const { actorId, headers, ...rest } = init;
  return fetch(`${process.env.DMAP_API_URL}${path}`, {
    ...rest,
    headers: {
      // Solo si hay body: Fastify rechaza cualquier request con
      // Content-Type: application/json y body vacio ("Body cannot be
      // empty..."), visto en produccion al usar "Aprobar" (sin payload).
      ...(rest.body ? { "Content-Type": "application/json" } : {}),
      "x-api-key": process.env.DMAP_API_KEY!,
      ...(actorId ? { "x-actor-id": actorId } : {}),
      ...headers,
    },
  }).catch(() => null);
}

export async function dmapJson<T = unknown>(
  path: string,
  init?: RequestInit & { actorId?: string }
): Promise<{ ok: boolean; status: number; data: T | { error?: string } }> {
  const res = await dmapFetch(path, init);
  if (!res) return { ok: false, status: 502, data: { error: "DMAP no respondió" } };
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
