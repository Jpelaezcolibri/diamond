import { FatalError } from "../lib/errors.js";
import { verifySignedState } from "../security/signed-state.js";
import { consumeNonce } from "../security/nonce-store.js";
import { encryptSecret, decryptSecret } from "../security/crypto.js";
import { META_OAUTH_SCOPES, META_TOKEN_REFRESH_THRESHOLD_DAYS } from "../config/constants.js";
import {
  buildOAuthDialogUrl,
  debugToken,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  getMe,
  listMetaAccounts
} from "../providers/meta/oauth.js";
import {
  deleteConnection as deleteConnectionRepo,
  getConnectionById,
  getMetaUserToken,
  listConnectionsByOrg,
  setConnectionStatus,
  upsertMetaUserToken,
  upsertSocialConnection
} from "../repositories/social-connections.repo.js";
import { recordAuditLog } from "../repositories/audit.repo.js";
import type { SocialConnectionRow, SocialPlatform } from "../repositories/types.js";

const OAUTH_STATE_TTL_SECONDS = 600;

/** true si al token le quedan menos de META_TOKEN_REFRESH_THRESHOLD_DAYS — separado para poder testearlo sin red. */
export function shouldRefreshToken(expiresAtEpochSeconds: number, nowMs: number = Date.now()): boolean {
  const daysLeft = (expiresAtEpochSeconds * 1000 - nowMs) / 86_400_000;
  return daysLeft < META_TOKEN_REFRESH_THRESHOLD_DAYS;
}

export function startConnection(orgId: string, returnUrl: string): { url: string } {
  return buildOAuthDialogUrl(orgId, returnUrl);
}

export interface OAuthCallbackResult {
  orgId: string;
  returnUrl: string;
}

/** Verifica state+nonce, intercambia el codigo por un user token long-lived y lo guarda cifrado (ver ARCHITECTURE.md #8). */
export async function completeOAuthCallback(state: string, code: string): Promise<OAuthCallbackResult> {
  const payload = verifySignedState(state);
  if (!consumeNonce(payload.nonce, OAUTH_STATE_TTL_SECONDS)) {
    throw new FatalError("El state OAuth ya fue utilizado (posible replay)");
  }

  const shortLived = await exchangeCodeForToken(code);
  const longLived = await exchangeForLongLivedToken(shortLived.access_token);
  const me = await getMe(longLived.access_token);

  const expiresAt = new Date(Date.now() + longLived.expires_in * 1000).toISOString();
  await upsertMetaUserToken(payload.orgId, me.id, encryptSecret(longLived.access_token), expiresAt);

  await recordAuditLog({
    org_id: payload.orgId,
    actor: "system:oauth",
    action: "meta_oauth_connected",
    entity_type: "meta_user_token",
    entity_id: me.id
  });

  return { orgId: payload.orgId, returnUrl: payload.returnUrl };
}

export interface AccountSummary {
  platform: SocialPlatform;
  externalAccountId: string;
  externalAccountName: string;
  linkedPageId?: string;
}

async function getDecryptedUserToken(orgId: string): Promise<string> {
  const userToken = await getMetaUserToken(orgId);
  if (!userToken) {
    throw new FatalError(`Organizacion ${orgId} no tiene una conexion Meta iniciada (falta completar el OAuth)`);
  }
  return decryptSecret(userToken.token_enc);
}

/** Cuentas disponibles para elegir en el admin — SIN tokens (ver ARCHITECTURE.md #8/#12). */
export async function discoverAccounts(orgId: string): Promise<AccountSummary[]> {
  const userToken = await getDecryptedUserToken(orgId);
  const pages = await listMetaAccounts(userToken);

  const accounts: AccountSummary[] = [];
  for (const page of pages) {
    accounts.push({ platform: "facebook", externalAccountId: page.id, externalAccountName: page.name });
    if (page.instagram_business_account) {
      accounts.push({
        platform: "instagram",
        externalAccountId: page.instagram_business_account.id,
        externalAccountName: page.instagram_business_account.username ?? page.name,
        linkedPageId: page.id
      });
    }
  }
  return accounts;
}

export interface ConnectionSelection {
  platform: SocialPlatform;
  externalAccountId: string;
}

/**
 * Guarda las conexiones elegidas por el usuario. Re-consulta /me/accounts en
 * vez de cachear tokens entre discoverAccounts() y este paso — mas simple y
 * evita servir un token vencido/stale.
 */
export async function saveConnections(
  orgId: string,
  selections: ConnectionSelection[],
  connectedBy?: string
): Promise<SocialConnectionRow[]> {
  const userToken = await getDecryptedUserToken(orgId);
  const pages = await listMetaAccounts(userToken);

  const saved: SocialConnectionRow[] = [];
  for (const selection of selections) {
    if (selection.platform === "facebook") {
      const page = pages.find((p) => p.id === selection.externalAccountId);
      if (!page) throw new FatalError(`Facebook Page ${selection.externalAccountId} no encontrada para esta org`);
      const conn = await upsertSocialConnection({
        org_id: orgId,
        platform: "facebook",
        external_account_id: page.id,
        external_account_name: page.name,
        access_token_enc: encryptSecret(page.access_token),
        token_expires_at: null,
        scopes: [...META_OAUTH_SCOPES],
        connected_by: connectedBy
      });
      saved.push(conn);
    } else {
      const page = pages.find((p) => p.instagram_business_account?.id === selection.externalAccountId);
      if (!page?.instagram_business_account) {
        throw new FatalError(`Cuenta Instagram ${selection.externalAccountId} no encontrada para esta org`);
      }
      const conn = await upsertSocialConnection({
        org_id: orgId,
        platform: "instagram",
        external_account_id: page.instagram_business_account.id,
        external_account_name: page.instagram_business_account.username ?? page.name,
        linked_page_id: page.id,
        access_token_enc: encryptSecret(page.access_token),
        token_expires_at: null,
        scopes: [...META_OAUTH_SCOPES],
        connected_by: connectedBy
      });
      saved.push(conn);
    }

    await recordAuditLog({
      org_id: orgId,
      actor: connectedBy ? `user:${connectedBy}` : "system:api",
      action: "social_connection_created",
      entity_type: selection.platform,
      entity_id: selection.externalAccountId
    });
  }

  return saved;
}

export type ConnectionStatusResult = "connected" | "expired" | "error";

/** Valida una conexion puntual contra /debug_token y actualiza su status. */
export async function validateConnection(connectionId: string): Promise<ConnectionStatusResult> {
  const connection = await getConnectionById(connectionId);
  if (!connection) throw new FatalError(`Conexion ${connectionId} no existe`);

  try {
    const token = decryptSecret(connection.access_token_enc);
    const info = await debugToken(token);
    if (!info.is_valid) {
      await setConnectionStatus(connectionId, "expired", "Token invalido segun /debug_token");
      return "expired";
    }
    await setConnectionStatus(connectionId, "connected");
    return "connected";
  } catch (err) {
    await setConnectionStatus(connectionId, "error", (err as Error).message);
    return "error";
  }
}

export async function removeConnection(connectionId: string): Promise<void> {
  await deleteConnectionRepo(connectionId);
}

/**
 * Worker semanal (ver ARCHITECTURE.md #8/#9): re-exchange el user token antes
 * de que expire (~60d) y revalida cada conexion de la org.
 */
export async function refreshOrgTokens(orgId: string): Promise<void> {
  const userTokenRow = await getMetaUserToken(orgId);
  if (!userTokenRow) return;

  const decrypted = decryptSecret(userTokenRow.token_enc);
  const info = await debugToken(decrypted);

  if (shouldRefreshToken(info.expires_at)) {
    const longLived = await exchangeForLongLivedToken(decrypted);
    const me = await getMe(longLived.access_token);
    const expiresAt = new Date(Date.now() + longLived.expires_in * 1000).toISOString();
    await upsertMetaUserToken(orgId, me.id, encryptSecret(longLived.access_token), expiresAt);
    await recordAuditLog({ org_id: orgId, actor: "system:token-refresh", action: "meta_user_token_refreshed" });
  }

  const connections = await listConnectionsByOrg(orgId);
  for (const connection of connections) {
    await validateConnection(connection.id);
  }
}
