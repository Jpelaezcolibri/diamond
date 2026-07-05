import { describe, expect, it } from "vitest";
import { buildOAuthDialogUrl } from "../../src/providers/meta/oauth.js";
import { verifySignedState } from "../../src/security/signed-state.js";
import { META_OAUTH_SCOPES } from "../../src/config/constants.js";

describe("buildOAuthDialogUrl", () => {
  it("apunta al dialogo de facebook.com con el client_id de la Meta App existente", () => {
    const { url } = buildOAuthDialogUrl("org-1", "https://crm.example.com/marketing/configuracion");
    const parsed = new URL(url);
    expect(parsed.hostname).toBe("www.facebook.com");
    expect(parsed.pathname).toMatch(/\/dialog\/oauth$/);
    expect(parsed.searchParams.get("client_id")).toBe("123456");
  });

  it("pide todos los scopes de ARCHITECTURE.md #8", () => {
    const { url } = buildOAuthDialogUrl("org-1", "https://crm.example.com");
    const scopes = new URL(url).searchParams.get("scope")?.split(",");
    expect(scopes).toEqual([...META_OAUTH_SCOPES]);
  });

  it("el redirect_uri apunta al callback de DMAP, no del CRM", () => {
    const { url } = buildOAuthDialogUrl("org-1", "https://crm.example.com");
    const redirectUri = new URL(url).searchParams.get("redirect_uri");
    expect(redirectUri).toBe("http://localhost:3010/api/v1/meta/oauth/callback");
  });

  it("el state es un state firmado y verificable con el orgId y returnUrl correctos", () => {
    const { url } = buildOAuthDialogUrl("org-42", "https://crm.example.com/marketing");
    const state = new URL(url).searchParams.get("state")!;
    const payload = verifySignedState(state);
    expect(payload.orgId).toBe("org-42");
    expect(payload.returnUrl).toBe("https://crm.example.com/marketing");
  });

  it("con config_id (Facebook Login for Business) usa config_id y NO scope — apps Business rechazan scope con error 100", () => {
    const { url } = buildOAuthDialogUrl("org-1", "https://crm.example.com", "1234567890");
    const params = new URL(url).searchParams;
    expect(params.get("config_id")).toBe("1234567890");
    expect(params.get("scope")).toBeNull();
    expect(params.get("response_type")).toBe("code");
  });
});
