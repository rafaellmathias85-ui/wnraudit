import crypto from "node:crypto";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const MS_AUTH_BASE = "https://login.microsoftonline.com";
const MICROSOFT_GRAPH_APP_ID = "00000003-0000-0000-c000-000000000000";

// Azure CLI well-known public client — pré-autorizado para Microsoft Graph (Graph API),
// suporta device_code e ROPC sem app registration próprio.
// Nota: Azure PowerShell (1950a258-...) foi bloqueado pela Microsoft (AADSTS65002).
const AZURE_CLI_CLIENT_ID = "04b07795-8ddb-461a-bbee-02f9e1bf7b46";

const ROPC_SCOPES = [
  "https://graph.microsoft.com/Application.ReadWrite.All",
  "https://graph.microsoft.com/AppRoleAssignment.ReadWrite.All",
  "https://graph.microsoft.com/DelegatedPermissionGrant.ReadWrite.All",
  "https://graph.microsoft.com/Directory.Read.All",
  "https://graph.microsoft.com/Directory.ReadWrite.All",
  "https://graph.microsoft.com/User.ReadWrite.All",
  "https://graph.microsoft.com/Group.ReadWrite.All",
  "https://graph.microsoft.com/User-PasswordProfile.ReadWrite.All",
  "https://graph.microsoft.com/Organization.Read.All",
  "offline_access",
].join(" ");

const BOOTSTRAP_SCOPES = ROPC_SCOPES;

const REQUIRED_APP_ROLES: Array<{ id?: string; value: string; description: string }> = [
  { id: "7ab1d382-f21e-4acd-a863-ba3e13f7da61", value: "Directory.Read.All", description: "Entra ID — usuarios, grupos, funcoes" },
  { value: "Directory.ReadWrite.All", description: "Entra ID — administracao completa do diretorio" },
  { id: "df021288-bdef-4463-88db-98f22de89214", value: "User.Read.All", description: "Leitura de usuarios" },
  { value: "User.ReadWrite.All", description: "Criacao, edicao, bloqueio e exclusao de usuarios" },
  { value: "User-PasswordProfile.ReadWrite.All", description: "Redefinicao de senha de usuarios" },
  { value: "Group.ReadWrite.All", description: "Criacao, edicao e exclusao de grupos" },
  { id: "498476ce-e0fe-48b0-b801-37ba7ef9dc52", value: "Organization.Read.All", description: "Informacoes da organizacao" },
  { id: "bf394140-e372-4bf9-a898-299cfc7564e5", value: "SecurityEvents.Read.All", description: "Defender — eventos de seguranca" },
  { id: "246dd0d5-5bd0-4def-940b-0421030a5b68", value: "Policy.Read.All", description: "Politicas de acesso condicional e MFA" },
  { id: "b0afded3-3588-46d8-8b3d-9842eff778da", value: "AuditLog.Read.All", description: "Logs de auditoria do tenant" },
  { id: "45cc0394-e837-488b-a098-1918f48d186c", value: "SecurityIncident.Read.All", description: "Defender — incidentes" },
  { id: "7a6ee1e7-141e-4cec-ae74-d9db155731ff", value: "DeviceManagementConfiguration.Read.All", description: "Intune — politicas de configuracao" },
  { id: "2f51be20-0bb4-4fed-bf7b-db946066c75e", value: "DeviceManagementManagedDevices.Read.All", description: "Intune — dispositivos gerenciados" },
  { id: "dc377aa6-52d8-4e23-dc5f-bb0fe9f7b6a7", value: "DeviceManagementRBAC.Read.All", description: "Intune — RBAC" },
  { id: "332a536c-c7ef-4017-ab91-336970924f0d", value: "Sites.Read.All", description: "SharePoint — sites e documentos" },
  { id: "2280dda6-0bfd-44ee-a2f4-cb867cfc4c1e", value: "Team.ReadBasic.All", description: "Teams — equipes" },
  { id: "59a6b24b-4225-4393-8165-ebaec5d55d7a", value: "Channel.ReadBasic.All", description: "Teams — canais" },
  { id: "693c5e45-0940-467d-9b8a-1022fb9d42ef", value: "Mail.ReadBasic.All", description: "Exchange — metadados de email" },
  { id: "e2a3a72e-5f79-4c64-b1b1-878b674786c9", value: "Mail.Read", description: "Exchange — leitura de mensagens" },
  { id: "1138cb37-bd11-4084-a2b7-9f71582aeddb", value: "DeviceManagementApps.Read.All", description: "Intune — aplicativos gerenciados" },
];

export interface DeviceCodeFlowData {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  interval: number;
  message: string;
}

export interface ProvisionResult {
  appId: string;
  objectId: string;
  clientSecret: string;
  permissionsGranted: string[];
  permissionsFailed: string[];
}

function getBootstrapClientId(): string {
  // Prefer a dedicated App Registration if provided; otherwise fall back to the
  // Azure CLI well-known public client, which is pre-authorized for Microsoft Graph
  // and supports both device_code and ROPC flows without a custom app registration.
  return process.env.MS_BOOTSTRAP_CLIENT_ID ?? AZURE_CLI_CLIENT_ID;
}

export async function startDeviceCodeFlow(microsoftTenantId: string): Promise<DeviceCodeFlowData> {
  const clientId = getBootstrapClientId();

  const res = await fetch(
    `${MS_AUTH_BASE}/${encodeURIComponent(microsoftTenantId)}/oauth2/v2.0/devicecode`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, scope: BOOTSTRAP_SCOPES }),
    },
  );

  const data = await res.json() as Record<string, unknown>;

  if (!res.ok) {
    const desc = (data.error_description as string | undefined) || (data.error as string | undefined) || "Erro desconhecido";
    throw new Error(`Falha ao iniciar autenticacao Microsoft: ${desc}`);
  }

  return {
    deviceCode: data.device_code as string,
    userCode: data.user_code as string,
    verificationUri: (data.verification_uri as string) || "https://microsoft.com/devicelogin",
    expiresAt: Date.now() + ((data.expires_in as number) || 900) * 1000,
    interval: (data.interval as number) || 5,
    message: (data.message as string) || `Acesse https://microsoft.com/devicelogin e insira o codigo ${data.user_code}`,
  };
}

export type PollResult =
  | { status: "pending" }
  | { status: "expired" }
  | { status: "declined" }
  | { status: "success"; accessToken: string };

export async function pollDeviceCodeFlow(
  microsoftTenantId: string,
  deviceCode: string,
): Promise<PollResult> {
  const clientId = getBootstrapClientId();

  const res = await fetch(
    `${MS_AUTH_BASE}/${encodeURIComponent(microsoftTenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
      }),
    },
  );

  const data = await res.json() as Record<string, unknown>;

  if (!res.ok) {
    const error = data.error as string | undefined;
    if (error === "authorization_pending" || error === "slow_down") return { status: "pending" };
    if (error === "authorization_declined") return { status: "declined" };
    if (error === "expired_token") return { status: "expired" };
    throw new Error(`Erro ao verificar autenticacao: ${data.error_description || error}`);
  }

  return { status: "success", accessToken: data.access_token as string };
}

/**
 * Autentica via ROPC (Resource Owner Password Credentials) usando o client público
 * do Azure CLI da Microsoft — pré-autorizado para Microsoft Graph, não requer app registration.
 * A senha nunca é armazenada; é usada apenas para obter o token.
 */
export async function authenticateWithCredentials(
  microsoftTenantId: string,
  username: string,
  password: string,
): Promise<string> {
  const res = await fetch(
    `${MS_AUTH_BASE}/${encodeURIComponent(microsoftTenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: getBootstrapClientId(),
        grant_type: "password",
        username,
        password,
        scope: ROPC_SCOPES,
      }),
    },
  );

  const data = await res.json() as Record<string, unknown>;

  if (!res.ok) {
    const error = data.error as string | undefined;
    const desc = data.error_description as string | undefined;

    if (error === "invalid_grant") {
      // AADSTS50076/50079 = MFA required, interaction_required also signals MFA
      if (
        desc?.includes("AADSTS50076") ||
        desc?.includes("AADSTS50079") ||
        desc?.includes("MFA") ||
        desc?.includes("multi-factor") ||
        desc?.includes("multi factor") ||
        desc?.includes("autenticação adicional")
      ) {
        throw new Error("MFA_REQUIRED");
      }
      throw new Error("Credenciais inválidas. Verifique o usuário e a senha e tente novamente.");
    }
    if (error === "interaction_required") {
      throw new Error("MFA_REQUIRED");
    }
    if (desc?.includes("AADSTS50076") || desc?.includes("AADSTS50079")) {
      throw new Error("MFA_REQUIRED");
    }
    if (desc?.includes("AADSTS70011")) {
      throw new Error("Escopo de permissões inválido. Contate o suporte WNR-Audit.");
    }
    if (desc?.includes("AADSTS90002") || desc?.includes("Tenant") ) {
      throw new Error(`Tenant '${microsoftTenantId}' não encontrado. Verifique o Tenant ID ou o domínio.`);
    }

    throw new Error(desc || error || "Falha na autenticação com a Microsoft.");
  }

  return data.access_token as string;
}

async function graphRequest<T = unknown>(
  accessToken: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null as T;

  const data = await res.json() as Record<string, unknown>;

  if (!res.ok) {
    const msg =
      (data?.error as Record<string, unknown> | undefined)?.message as string | undefined
      || `Graph API ${method} ${path} retornou ${res.status}`;
    throw new Error(msg);
  }

  return data as T;
}

interface GraphServicePrincipal {
  id: string;
  appId: string;
  appRoles: Array<{ id: string; value: string }>;
}

interface GraphApplication {
  id: string;
  appId: string;
}

export async function provisionTenantApp(
  accessToken: string,
  tenantDisplayName: string,
): Promise<ProvisionResult> {
  const permissionsGranted: string[] = [];
  const permissionsFailed: string[] = [];

  const graphSpResult = await graphRequest<{ value: GraphServicePrincipal[] }>(
    accessToken,
    "GET",
    `/servicePrincipals?$filter=appId eq '${MICROSOFT_GRAPH_APP_ID}'&$select=id,appId,appRoles`,
  );

  if (!graphSpResult?.value?.length) {
    throw new Error("Service principal do Microsoft Graph nao encontrado no tenant.");
  }

  const graphSp = graphSpResult.value[0];
  const roleMap: Record<string, string> = {};
  for (const role of graphSp.appRoles) {
    roleMap[role.value] = role.id;
  }

  const resolveRoleId = (role: { id?: string; value: string }): string => {
    const roleId = roleMap[role.value] ?? role.id;
    if (!roleId) {
      throw new Error(`Permissao Microsoft Graph nao encontrada: ${role.value}`);
    }
    return roleId;
  };

  const requiredResourceAccess = [
    {
      resourceAppId: MICROSOFT_GRAPH_APP_ID,
      resourceAccess: REQUIRED_APP_ROLES.map((r) => ({
        id: resolveRoleId(r),
        type: "Role",
      })),
    },
  ];

  const app = await graphRequest<GraphApplication>(accessToken, "POST", "/applications", {
    displayName: `WNR-Audit — ${tenantDisplayName}`,
    signInAudience: "AzureADMyOrg",
    requiredResourceAccess,
    notes: "Criado automaticamente pelo WNR-Audit. Nao remover manualmente.",
  });

  const appObjectId = app.id;
  const appId = app.appId;

  await new Promise((r) => setTimeout(r, 3000));

  const sp = await graphRequest<{ id: string }>(accessToken, "POST", "/servicePrincipals", {
    appId,
  });

  const spId = sp.id;

  await new Promise((r) => setTimeout(r, 2000));

  const results = await Promise.allSettled(
    REQUIRED_APP_ROLES.map(async (role) => {
      const roleId = resolveRoleId(role);
      await graphRequest(
        accessToken,
        "POST",
        `/servicePrincipals/${spId}/appRoleAssignments`,
        { principalId: spId, resourceId: graphSp.id, appRoleId: roleId },
      );
      return role.value;
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      permissionsGranted.push(result.value as string);
    } else {
      const permIdx = results.indexOf(result);
      permissionsFailed.push(REQUIRED_APP_ROLES[permIdx]?.value ?? "unknown");
    }
  }

  const secretResult = await graphRequest<{ secretText: string }>(
    accessToken,
    "POST",
    `/applications/${appObjectId}/addPassword`,
    {
      passwordCredential: {
        displayName: "WNR-Audit Auto-Provisioned",
        endDateTime: new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000).toISOString(),
      },
    },
  );

  return {
    appId,
    objectId: appObjectId,
    clientSecret: secretResult.secretText,
    permissionsGranted,
    permissionsFailed,
  };
}

const ALGO = "aes-256-gcm";

function getEncryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET nao configurado");
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
}

export function decryptSecret(ciphertext: string): string {
  const key = getEncryptionKey();
  const [ivHex, authTagHex, encryptedHex] = ciphertext.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted).toString("utf8") + decipher.final("utf8");
}

/**
 * Autentica via Client Credentials Flow usando um App Registration criado manualmente
 * pelo administrador do tenant. Não depende de nenhum client de primeira parte da Microsoft.
 * Retorna um access token válido para chamadas ao Microsoft Graph.
 */
export async function validateAndConnectWithApp(
  microsoftTenantId: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const res = await fetch(
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

  const data = await res.json() as Record<string, unknown>;

  if (!res.ok) {
    const error = data.error as string | undefined;
    const desc = data.error_description as string | undefined;

    if (error === "invalid_client") {
      throw new Error("Client ID ou Client Secret inválido. Verifique as credenciais do App Registration no Azure Portal.");
    }
    if (error === "unauthorized_client") {
      throw new Error("Este App Registration não tem permissão para autenticar como aplicação. Verifique se o tipo de conta é 'Contas neste diretório' e se as permissões são do tipo 'Aplicativo' (não Delegado).");
    }
    if (desc?.includes("AADSTS700016")) {
      throw new Error("Application ID (Client ID) não encontrado neste tenant. Verifique se o App Registration pertence ao tenant correto.");
    }
    throw new Error(desc ?? `Erro ao autenticar: ${error ?? res.status}`);
  }

  const accessToken = data.access_token as string;

  // Valida uma chamada básica ao Graph para confirmar que as permissões estão corretas
  const testRes = await fetch(`${GRAPH_BASE}/organization?$select=id,displayName`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!testRes.ok) {
    const testData = await testRes.json() as Record<string, unknown>;
    const msg = ((testData?.error as Record<string, unknown> | undefined)?.message as string | undefined)
      ?? "Falha ao chamar Microsoft Graph";
    throw new Error(`Credenciais válidas, mas faltam permissões no Graph: ${msg}. Adicione 'Organization.Read.All' e clique em 'Grant admin consent'.`);
  }

  return accessToken;
}
