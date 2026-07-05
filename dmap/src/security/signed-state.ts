import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

export interface OAuthStatePayload {
  orgId: string;
  nonce: string;
  returnUrl: string;
  exp: number; // epoch seconds
}

function sign(data: string): string {
  return createHmac("sha256", env.DMAP_ENCRYPTION_KEY).update(data).digest("base64url");
}

/** Crea un state firmado para el flujo OAuth (ver dmap/ARCHITECTURE.md #8). */
export function createSignedState(orgId: string, returnUrl: string, ttlSeconds = 600): { state: string; nonce: string } {
  const nonce = randomUUID();
  const payload: OAuthStatePayload = {
    orgId,
    nonce,
    returnUrl,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds
  };
  const json = JSON.stringify(payload);
  const encoded = Buffer.from(json, "utf8").toString("base64url");
  const signature = sign(encoded);
  return { state: `${encoded}.${signature}`, nonce };
}

export function verifySignedState(state: string): OAuthStatePayload {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature) {
    throw new Error("State OAuth malformado");
  }
  const expected = sign(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("Firma de state OAuth invalida");
  }
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OAuthStatePayload;
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("State OAuth expirado");
  }
  return payload;
}
