import { env } from "../../config/env.js";
import { GRAPH_API_VERSION, META_OAUTH_SCOPES } from "../../config/constants.js";
import { createSignedState } from "../../security/signed-state.js";
import { graphGet } from "./graph-client.js";

function callbackUrl(): string {
  return `${env.DMAP_PUBLIC_URL}/api/v1/meta/oauth/callback`;
}

/** Dialogo de login: reusa la MISMA Meta App de WhatsApp/Sofi — nunca se crea una app nueva (ver ARCHITECTURE.md #8). */
export function buildOAuthDialogUrl(orgId: string, returnUrl: string): { url: string } {
  const { state } = createSignedState(orgId, returnUrl);
  const url = new URL(`https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", env.META_APP_ID);
  url.searchParams.set("redirect_uri", callbackUrl());
  url.searchParams.set("state", state);
  url.searchParams.set("scope", META_OAUTH_SCOPES.join(","));
  return { url: url.toString() };
}

export interface MetaTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

export async function exchangeCodeForToken(code: string): Promise<MetaTokenResponse> {
  return graphGet<MetaTokenResponse>("/oauth/access_token", {
    client_id: env.META_APP_ID,
    client_secret: env.META_APP_SECRET,
    redirect_uri: callbackUrl(),
    code
  });
}

/** El user token corto (~1-2h) se cambia por uno long-lived (~60 dias) — de ahi se derivan page tokens que no expiran. */
export async function exchangeForLongLivedToken(shortLivedToken: string): Promise<Required<MetaTokenResponse>> {
  const response = await graphGet<MetaTokenResponse>("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: env.META_APP_ID,
    client_secret: env.META_APP_SECRET,
    fb_exchange_token: shortLivedToken
  });
  return { ...response, expires_in: response.expires_in ?? 60 * 24 * 60 * 60 };
}

export interface MetaAccount {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string; profile_picture_url?: string };
}

/** Pages + IG Business disponibles para el usuario que conecto — devuelve tokens (uso interno, nunca se exponen al CRM). */
export async function listMetaAccounts(userAccessToken: string): Promise<MetaAccount[]> {
  const response = await graphGet<{ data: MetaAccount[] }>(
    "/me/accounts",
    { fields: "id,name,access_token,instagram_business_account{id,username,profile_picture_url}" },
    userAccessToken
  );
  return response.data;
}

export async function getMe(accessToken: string): Promise<{ id: string }> {
  return graphGet<{ id: string }>("/me", {}, accessToken);
}

export interface DebugTokenInfo {
  is_valid: boolean;
  expires_at: number;
  scopes: string[];
}

/** Valida un token con la app access token (appId|appSecret) — no necesita appsecret_proof adicional. */
export async function debugToken(inputToken: string): Promise<DebugTokenInfo> {
  const appAccessToken = `${env.META_APP_ID}|${env.META_APP_SECRET}`;
  const response = await graphGet<{ data: DebugTokenInfo }>("/debug_token", {
    input_token: inputToken,
    access_token: appAccessToken
  });
  return response.data;
}
