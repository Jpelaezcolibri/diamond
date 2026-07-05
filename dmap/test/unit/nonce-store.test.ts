import { describe, expect, it } from "vitest";
import { consumeNonce } from "../../src/security/nonce-store.js";

describe("consumeNonce", () => {
  it("acepta un nonce la primera vez", () => {
    expect(consumeNonce("n1", 60)).toBe(true);
  });

  it("rechaza el mismo nonce en un segundo uso (replay)", () => {
    consumeNonce("n2", 60);
    expect(consumeNonce("n2", 60)).toBe(false);
  });

  it("nonces distintos no interfieren entre si", () => {
    expect(consumeNonce("n3", 60)).toBe(true);
    expect(consumeNonce("n4", 60)).toBe(true);
    expect(consumeNonce("n3", 60)).toBe(false);
    expect(consumeNonce("n4", 60)).toBe(false);
  });
});
