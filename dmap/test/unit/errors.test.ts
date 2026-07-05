import { describe, expect, it } from "vitest";
import { classifyGraphError, FatalError, RetryableError, isFatal, isRetryable } from "../../src/lib/errors.js";

describe("classifyGraphError", () => {
  it("clasifica codigos de rate-limit como reintentables", () => {
    for (const code of [1, 2, 4, 17, 32]) {
      const err = classifyGraphError(code, "rate limited");
      expect(err).toBeInstanceOf(RetryableError);
      expect(isRetryable(err)).toBe(true);
    }
  });

  it("clasifica token invalido (190) como fatal", () => {
    const err = classifyGraphError(190, "Invalid OAuth access token");
    expect(err).toBeInstanceOf(FatalError);
    expect(isFatal(err)).toBe(true);
  });

  it("trata codigos desconocidos como reintentables por seguridad", () => {
    const err = classifyGraphError(99999, "codigo raro");
    expect(err).toBeInstanceOf(RetryableError);
  });

  it("isFatal/isRetryable distinguen correctamente entre las dos clases", () => {
    const retryable = new RetryableError("x");
    const fatal = new FatalError("y");
    expect(isRetryable(retryable)).toBe(true);
    expect(isRetryable(fatal)).toBe(false);
    expect(isFatal(fatal)).toBe(true);
    expect(isFatal(retryable)).toBe(false);
  });
});
