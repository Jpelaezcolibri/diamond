import { describe, expect, it } from "vitest";
import { shouldRefreshToken } from "../../src/services/connection.service.js";
import { META_TOKEN_REFRESH_THRESHOLD_DAYS } from "../../src/config/constants.js";

const DAY_MS = 86_400_000;

describe("shouldRefreshToken", () => {
  const now = 1_720_000_000_000; // fijo, para que el test sea determinista

  it("no refresca si al token le quedan muchos dias", () => {
    const expiresAt = Math.floor((now + 40 * DAY_MS) / 1000);
    expect(shouldRefreshToken(expiresAt, now)).toBe(false);
  });

  it("refresca si al token le quedan menos dias que el umbral", () => {
    const expiresAt = Math.floor((now + (META_TOKEN_REFRESH_THRESHOLD_DAYS - 1) * DAY_MS) / 1000);
    expect(shouldRefreshToken(expiresAt, now)).toBe(true);
  });

  it("refresca si el token ya vencio", () => {
    const expiresAt = Math.floor((now - DAY_MS) / 1000);
    expect(shouldRefreshToken(expiresAt, now)).toBe(true);
  });

  it("el umbral es el limite exacto (justo en el borde no refresca)", () => {
    const expiresAt = Math.floor((now + META_TOKEN_REFRESH_THRESHOLD_DAYS * DAY_MS) / 1000);
    expect(shouldRefreshToken(expiresAt, now)).toBe(false);
  });
});
