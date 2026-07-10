// Helper unico para hablar con la API interna del bot (BOT_API_URL + BOT_API_KEY).
// Centraliza el patron de fetch que hoy vive inline en send/modo/media; lo usa
// el Centro de Comando (SOFI). Solo se llama desde route handlers/server
// components — nunca desde el browser (la key es server-side).
// TODO(reuse): migrar send/modo/media a este helper cuando se toquen.

type BotResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number };

export async function callBot<T = unknown>(path: string, body: unknown): Promise<BotResult<T>> {
  // timeout: evita que la request del CRM quede colgada si el bot no responde.
  const res = await fetch(`${process.env.BOT_API_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.BOT_API_KEY!,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  }).catch(() => null);

  if (!res || !res.ok) {
    const b = res ? await res.json().catch(() => ({})) : {};
    return {
      ok: false,
      error: (b as { error?: string }).error || "El bot no respondió",
      status: res?.status || 502,
    };
  }
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: true, data };
}
