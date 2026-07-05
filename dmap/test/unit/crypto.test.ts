import { describe, expect, it } from "vitest";
import { encryptSecret, decryptSecret } from "../../src/security/crypto.js";
import { createSignedState, verifySignedState } from "../../src/security/signed-state.js";

describe("crypto", () => {
  it("cifra y descifra un secreto de ida y vuelta", () => {
    const plaintext = "EAAG_test_page_token_1234567890";
    const encrypted = encryptSecret(plaintext);
    expect(encrypted.startsWith("v1:")).toBe(true);
    expect(encrypted).not.toContain(plaintext);
    expect(decryptSecret(encrypted)).toBe(plaintext);
  });

  it("produce ciphertext distinto en cada llamada (IV aleatorio)", () => {
    const a = encryptSecret("mismo-valor");
    const b = encryptSecret("mismo-valor");
    expect(a).not.toBe(b);
  });

  it("rechaza payloads con formato invalido", () => {
    expect(() => decryptSecret("no-es-valido")).toThrow();
  });
});

describe("signed-state (OAuth)", () => {
  it("crea y verifica un state valido", () => {
    const { state } = createSignedState("org-123", "https://crm.example.com/marketing/configuracion");
    const payload = verifySignedState(state);
    expect(payload.orgId).toBe("org-123");
    expect(payload.returnUrl).toBe("https://crm.example.com/marketing/configuracion");
  });

  it("rechaza un state alterado", () => {
    const { state } = createSignedState("org-123", "https://crm.example.com");
    const tampered = state.slice(0, -2) + "xx";
    expect(() => verifySignedState(tampered)).toThrow();
  });

  it("rechaza un state expirado", () => {
    const { state } = createSignedState("org-123", "https://crm.example.com", -10);
    expect(() => verifySignedState(state)).toThrow(/expirado/);
  });
});
