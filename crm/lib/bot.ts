// Helper unico para hablar con la API interna del bot (BOT_API_URL + BOT_API_KEY).
// Centraliza el patron de fetch que hoy vive inline en send/modo/media; lo usa
// el Centro de Comando (SOFI). Solo se llama desde route handlers/server
// components — nunca desde el browser (la key es server-side).
// TODO(reuse): migrar send/modo/media a este helper cuando se toquen.

// `timeout` distingue "se acabó el tiempo" de "el bot contestó que no"
// (Juan, 2026-09-04). No es cosmético: en las operaciones que YA cambiaron el
// registro antes de responder —cancelar una cita lo hace en el primer
// instante, a propósito— un timeout NO significa que no pasó nada. Quien
// pinta el mensaje necesita poder decir "no sabemos" en vez de afirmar lo
// contrario de la verdad.
type BotResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number; timeout: boolean };

// Cuanto se le da al bot para contestar. 60 s alcanza para todo lo que es una
// consulta directa a la base.
//
// El Centro de Comando (SOFI) es otra cosa: una pregunta como "por que se estan
// rechazando los pedidos" le hace usar varias herramientas y medido en
// produccion el 2026-08-24 tardo 45 s. Con 60 s pasaba raspando, y cualquier
// consulta un poco mas pesada caia en el timeout — y lo que veia Juan en el
// chat era "El bot no respondio", cuando en realidad Sofi habia respondido bien
// y nadie estaba escuchando. Por eso el llamador puede pedir mas.
const TIMEOUT_DEFAULT_MS = 60_000;

export async function callBot<T = unknown>(
  path: string,
  body: unknown,
  { timeoutMs = TIMEOUT_DEFAULT_MS }: { timeoutMs?: number } = {}
): Promise<BotResult<T>> {
  let abortado = false;
  const res = await fetch(`${process.env.BOT_API_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.BOT_API_KEY!,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((e) => {
    // Distinguir "se corto el tiempo" de "el bot esta caido": el mensaje
    // generico manda a buscar el problema al lugar equivocado, que es
    // exactamente lo que paso el 2026-08-24.
    abortado = e?.name === "TimeoutError" || e?.name === "AbortError";
    return null;
  });

  if (!res || !res.ok) {
    const b = res ? await res.json().catch(() => ({})) : {};
    return {
      ok: false,
      error:
        (b as { error?: string }).error ||
        (abortado
          ? `Sofi tardo mas de ${Math.round(timeoutMs / 1000)} s en responder. Volve a preguntarle.`
          : "El bot no respondió"),
      status: res?.status || 502,
      timeout: abortado,
    };
  }
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: true, data };
}
