/**
 * Descarga una imagen a Buffer con reintentos y timeout. El origen habitual
 * son las fotos de Wasi (images.wasi.co / image.wasi.co): un fallo transitorio
 * de ese CDN NO debe dejar sin foto un creative o un slide del carrusel — sin
 * reintento, un 5xx/timeout puntual borraba el slide para siempre (bug real:
 * "el carrusel se queda sin cargar y no deja publicar").
 *
 * Nunca deja una request colgada: cada intento tiene su AbortController con
 * timeout. Lanza solo tras agotar todos los intentos — el caller decide si un
 * fallo definitivo tumba la pieza o solo la degrada (ver produceCarouselSlides,
 * que omite el slide y sigue).
 */
export interface FetchImageOptions {
  /** Inyectable para tests. Default: fetch global. */
  fetchFn?: typeof fetch;
  /** Intentos totales (no reintentos adicionales). Default 3. */
  attempts?: number;
  /** Timeout por intento en ms. Default 15000. */
  timeoutMs?: number;
  /** Backoff base en ms; espera = baseDelayMs * 2^(intento-1). Default 400. */
  baseDelayMs?: number;
  /** Inyectable para tests (evita esperas reales). Default: setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function fetchImageBuffer(url: string, options: FetchImageOptions = {}): Promise<Buffer> {
  const fetchFn = options.fetchFn ?? fetch;
  const attempts = options.attempts ?? 3;
  const timeoutMs = options.timeoutMs ?? 15000;
  const baseDelayMs = options.baseDelayMs ?? 400;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchFn(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`status ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < attempts) await sleep(baseDelayMs * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`No se pudo descargar ${url} tras ${attempts} intentos: ${lastError?.message ?? "error desconocido"}`);
}
