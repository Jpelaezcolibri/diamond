import { describe, expect, it, beforeAll } from "vitest";

beforeAll(() => {
  process.env.DMAP_API_KEY ??= "test-api-key-0123456789";
  process.env.DMAP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
  process.env.REDIS_URL ??= "redis://localhost:6379";
  process.env.SUPABASE_URL ??= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_KEY ??= "service-key";
  process.env.ANTHROPIC_API_KEY ??= "sk-ant-test";
  process.env.META_APP_ID ??= "123456";
  process.env.META_APP_SECRET ??= "secret";
  process.env.DMAP_PUBLIC_URL ??= "http://localhost:3010";
  process.env.CRM_URL ??= "http://localhost:3000";
});

describe("crypto", () => {
  it("cifra y descifra un secreto de ida y vuelta", async () => {
    const { encryptSecret, decryptSecret } = await import("../../src/security/crypto.js");
    const plaintext = "EAAG_test_page_token_1234567890";
    const encrypted = encryptSecret(plaintext);
    expect(encrypted.startsWith("v1:")).toBe(true);
    expect(encrypted).not.toContain(plaintext);
    expect(decryptSecret(encrypted)).toBe(plaintext);
  });

  it("produce ciphertext distinto en cada llamada (IV aleatorio)", async () => {
    const { encryptSecret } = await import("../../src/security/crypto.js");
    const a = encryptSecret("mismo-valor");
    const b = encryptSecret("mismo-valor");
    expect(a).not.toBe(b);
  });

  it("rechaza payloads con formato invalido", async () => {
    const { decryptSecret } = await import("../../src/security/crypto.js");
    expect(() => decryptSecret("no-es-valido")).toThrow();
  });
});

describe("signed-state (OAuth)", () => {
  it("crea y verifica un state valido", async () => {
    const { createSignedState, verifySignedState } = await import("../../src/security/signed-state.js");
    const { state } = createSignedState("org-123", "https://crm.example.com/marketing/configuracion");
    const payload = verifySignedState(state);
    expect(payload.orgId).toBe("org-123");
    expect(payload.returnUrl).toBe("https://crm.example.com/marketing/configuracion");
  });

  it("rechaza un state alterado", async () => {
    const { createSignedState, verifySignedState } = await import("../../src/security/signed-state.js");
    const { state } = createSignedState("org-123", "https://crm.example.com");
    const tampered = state.slice(0, -2) + "xx";
    expect(() => verifySignedState(tampered)).toThrow();
  });

  it("rechaza un state expirado", async () => {
    const { createSignedState, verifySignedState } = await import("../../src/security/signed-state.js");
    const { state } = createSignedState("org-123", "https://crm.example.com", -10);
    expect(() => verifySignedState(state)).toThrow(/expirado/);
  });
});
