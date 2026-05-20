import crypto from "node:crypto";

const MS_AUTH_BASE = "https://login.microsoftonline.com";

export function getOAuthRedirectUri(): string {
  if (process.env.MS_OAUTH_REDIRECT_URI) return process.env.MS_OAUTH_REDIRECT_URI;
  const domain = process.env.REPLIT_DEV_DOMAIN;
  if (domain) return `https://${domain}/api/oauth/ms/callback`;
  return "http://localhost:3000/api/oauth/ms/callback";
}

export function getWnrAuditOAuthClientId(): string {
  const id = process.env.MS_OAUTH_CLIENT_ID;
  if (!id) throw new Error("MS_OAUTH_CLIENT_ID não configurado");
  return id;
}

export function getWnrAuditOAuthClientSecret(): string {
  const secret = process.env.MS_OAUTH_CLIENT_SECRET;
  if (!secret) throw new Error("MS_OAUTH_CLIENT_SECRET não configurado");
  return secret;
}

function getHmacKey(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET não configurado");
  return s;
}

export function createSignedState(tenantId: string, customerId: string): string {
  const payload = JSON.stringify({ tenantId, customerId, ts: Date.now() });
  const b64 = Buffer.from(payload).toString("base64url");
  const hmac = crypto.createHmac("sha256", getHmacKey()).update(b64).digest("hex");
  return `${b64}.${hmac}`;
}

export function verifySignedState(state: string): { tenantId: string; customerId: string } {
  const dotIndex = state.lastIndexOf(".");
  if (dotIndex === -1) throw new Error("Estado OAuth inválido");
  const b64 = state.slice(0, dotIndex);
  const sig = state.slice(dotIndex + 1);
  const expected = crypto.createHmac("sha256", getHmacKey()).update(b64).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) {
    throw new Error("Assinatura do estado OAuth inválida");
  }
  const parsed = JSON.parse(Buffer.from(b64, "base64url").toString("utf8")) as {
    tenantId: string;
    customerId: string;
    ts: number;
  };
  const ageMs = Date.now() - parsed.ts;
  if (ageMs > 15 * 60 * 1000) throw new Error("Estado OAuth expirado (limite: 15 minutos)");
  return { tenantId: parsed.tenantId, customerId: parsed.customerId };
}

export function buildAdminConsentUrl(opts: {
  microsoftTenantId: string;
  state: string;
}): string {
  const clientId = getWnrAuditOAuthClientId();
  const redirectUri = getOAuthRedirectUri();
  const tenantId = opts.microsoftTenantId.trim();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "https://graph.microsoft.com/.default",
    state: opts.state,
  });
  return `${MS_AUTH_BASE}/${encodeURIComponent(tenantId)}/v2.0/adminconsent?${params.toString()}`;
}

export interface OrganizationInfo {
  tenantId: string;
  displayName: string | null;
  verifiedDomains: string[];
  defaultDomain: string | null;
}

export async function verifyClientCredentialsAccess(microsoftTenantId: string): Promise<OrganizationInfo> {
  const clientId = getWnrAuditOAuthClientId();
  const clientSecret = getWnrAuditOAuthClientSecret();

  const tokenRes = await fetch(
    `${MS_AUTH_BASE}/${encodeURIComponent(microsoftTenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
        scope: "https://graph.microsoft.com/.default",
      }),
    },
  );

  const tokenData = await tokenRes.json() as Record<string, unknown>;

  if (!tokenRes.ok) {
    const desc = tokenData.error_description as string | undefined;
    const err = tokenData.error as string | undefined;
    throw new Error(desc ?? err ?? `Falha ao obter token: HTTP ${tokenRes.status}`);
  }

  const accessToken = tokenData.access_token as string;

  const graphRes = await fetch(
    "https://graph.microsoft.com/v1.0/organization?$select=id,displayName,verifiedDomains",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!graphRes.ok) {
    const graphData = await graphRes.json() as Record<string, unknown>;
    const msg =
      ((graphData?.error as Record<string, unknown> | undefined)?.message as string | undefined)
      ?? `Graph API retornou ${graphRes.status}`;
    throw new Error(`Consentimento concedido, mas faltam permissões no Graph: ${msg}`);
  }

  const graphData = await graphRes.json() as {
    value?: Array<{
      id?: string;
      displayName?: string;
      verifiedDomains?: Array<{ name?: string; isDefault?: boolean }>;
    }>;
  };

  const org = graphData.value?.[0];
  if (!org?.id) {
    throw new Error("Não foi possível obter informações da organização Microsoft.");
  }

  const verifiedDomains = (org.verifiedDomains ?? [])
    .map((d) => d.name?.toLowerCase())
    .filter((d): d is string => Boolean(d));

  const defaultDomain = (org.verifiedDomains ?? [])
    .find((d) => d.isDefault && d.name)?.name?.toLowerCase() ?? null;

  return {
    tenantId: org.id,
    displayName: org.displayName ?? null,
    verifiedDomains,
    defaultDomain,
  };
}
