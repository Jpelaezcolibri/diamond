/**
 * Jerarquia de errores para clasificar reintentos en workers (ver dmap/ARCHITECTURE.md #10).
 */
export class RetryableError extends Error {
  readonly retryable = true as const;
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "RetryableError";
    this.cause = cause;
  }
}

export class FatalError extends Error {
  readonly retryable = false as const;
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "FatalError";
    this.cause = cause;
  }
}

const RETRYABLE_GRAPH_ERROR_CODES = new Set([1, 2, 4, 17, 32]);
const FATAL_GRAPH_ERROR_CODES = new Set([190, 200, 10, 200, 100]);

export function classifyGraphError(errorCode: number, message: string): RetryableError | FatalError {
  if (RETRYABLE_GRAPH_ERROR_CODES.has(errorCode)) {
    return new RetryableError(`Graph API error retryable (code ${errorCode}): ${message}`);
  }
  if (FATAL_GRAPH_ERROR_CODES.has(errorCode)) {
    return new FatalError(`Graph API error fatal (code ${errorCode}): ${message}`);
  }
  // Por defecto tratamos codigos desconocidos como reintentables (mas seguro que perder el job).
  return new RetryableError(`Graph API error no clasificado (code ${errorCode}): ${message}`);
}

export function isRetryable(err: unknown): boolean {
  return err instanceof RetryableError;
}

export function isFatal(err: unknown): boolean {
  return err instanceof FatalError;
}
