import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";

const PUBLIC_PATHS = new Set(["/health", "/api/v1/meta/oauth/callback"]);

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Middleware X-API-Key. Consumido solo server-side (proxy del CRM) — ver dmap/ARCHITECTURE.md #12. */
export async function apiKeyAuth(request: FastifyRequest, reply: FastifyReply) {
  const path = request.url.split("?")[0] ?? "";
  if (PUBLIC_PATHS.has(path)) {
    return;
  }
  const provided = request.headers["x-api-key"];
  if (typeof provided !== "string" || !safeCompare(provided, env.DMAP_API_KEY)) {
    reply.code(401).send({ error: "unauthorized" });
    return reply;
  }
}
