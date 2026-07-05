import { createHmac } from "node:crypto";
import { env } from "../../config/env.js";
import { GRAPH_API_BASE } from "../../config/constants.js";
import { classifyGraphError, RetryableError } from "../../lib/errors.js";

/** Prueba de que la llamada viene de la app (recomendado por Meta para todas las llamadas server-to-server). */
function appsecretProof(accessToken: string): string {
  return createHmac("sha256", env.META_APP_SECRET).update(accessToken).digest("hex");
}

interface GraphErrorBody {
  error?: { message: string; type?: string; code?: number; error_subcode?: number };
}

async function parseGraphResponse<T>(response: Response, url: URL): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    if (!response.ok) throw new RetryableError(`Graph API respondio ${response.status} sin JSON`, err);
    body = {};
  }
  if (!response.ok) {
    const err = (body as GraphErrorBody).error;
    // Nunca loguear la URL completa: puede llevar access_token/appsecret_proof.
    throw classifyGraphError(err?.code ?? response.status, err?.message ?? `Graph API respondio ${response.status} (${url.pathname})`);
  }
  return body as T;
}

function buildUrl(path: string, params: Record<string, string>, accessToken?: string): URL {
  const url = new URL(`${GRAPH_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  if (accessToken) {
    url.searchParams.set("access_token", accessToken);
    url.searchParams.set("appsecret_proof", appsecretProof(accessToken));
  }
  return url;
}

export async function graphGet<T>(path: string, params: Record<string, string> = {}, accessToken?: string): Promise<T> {
  const url = buildUrl(path, params, accessToken);
  const response = await fetch(url);
  return parseGraphResponse<T>(response, url);
}

export async function graphPost<T>(path: string, body: Record<string, unknown>, accessToken: string): Promise<T> {
  const url = buildUrl(path, {}, accessToken);
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return parseGraphResponse<T>(response, url);
}

export async function graphDelete<T>(path: string, accessToken: string): Promise<T> {
  const url = buildUrl(path, {}, accessToken);
  const response = await fetch(url, { method: "DELETE" });
  return parseGraphResponse<T>(response, url);
}
