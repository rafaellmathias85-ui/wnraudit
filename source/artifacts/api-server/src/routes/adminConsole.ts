import { Router, type IRouter, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import pino from "pino";
import { db, microsoftTenantsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { decryptSecret } from "../lib/msProvisioner";
import { getOAuthClientSecretForClientId } from "../lib/oauth";

const log = pino({ name: "admin-console" });
const router: IRouter = Router();

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const MS_AUTH_BASE = "https://login.microsoftonline.com";
const REQUIRED_ADMIN_CONSOLE_ROLES = [
  "Directory.ReadWrite.All",
  "User.ReadWrite.All",
  "User-PasswordProfile.ReadWrite.All",
  "Group.ReadWrite.All",
  "Application.ReadWrite.All",
  "Sites.Read.All",
  "Files.Read.All",
];

type GraphMethod = "GET" | "POST" | "PATCH" | "DELETE";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function decodeTokenRoles(token: string): string[] {
  const [, payload] = token.split(".");
  if (!payload) return [];

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(normalized, "base64").toString("utf8");
    const parsed = JSON.parse(json) as { roles?: unknown };
    return Array.isArray(parsed.roles)
      ? parsed.roles.filter((role): role is string => typeof role === "string")
      : [];
  } catch {
    return [];
  }
}

function graphErrorMessage(status: number, data: unknown): string {
  const graphMessage =
    typeof data === "object" && data
      ? (((data as Record<string, unknown>).error as Record<string, unknown> | undefined)
          ?.message as string | undefined)
      : undefined;

  if (status === 403) {
    return graphMessage
      ? `Microsoft Graph recusou a acao porque o token do App WNR-Audit nao contem a permissao de aplicacao exigida: ${graphMessage}. Verifique o painel Permissoes do Admin Console para ver quais roles estao faltando.`
      : "Microsoft Graph recusou a acao porque o token do App WNR-Audit nao contem a permissao de aplicacao exigida. Verifique o painel Permissoes do Admin Console.";
  }

  return graphMessage ?? `Microsoft Graph retornou HTTP ${status}`;
}

async function getTenantForCustomer(customerId: string, tenantId: string) {
  const [tenant] = await db
    .select()
    .from(microsoftTenantsTable)
    .where(
      and(
        eq(microsoftTenantsTable.id, tenantId),
        eq(microsoftTenantsTable.customerId, customerId),
      ),
    )
    .limit(1);

  return tenant ?? null;
}

async function getTenantAccessToken(tenant: {
  microsoftTenantId: string;
  provisionedAppId: string | null;
  encryptedClientSecret: string | null;
}): Promise<string> {
  if (!tenant.provisionedAppId) {
    throw new Error("Tenant nao esta conectado com credenciais Microsoft.");
  }

  const clientSecret = tenant.encryptedClientSecret
    ? decryptSecret(tenant.encryptedClientSecret)
    : getOAuthClientSecretForClientId(tenant.provisionedAppId);

  if (!clientSecret) {
    throw new Error("Segredo OAuth do WNR-Audit nao esta configurado no servidor.");
  }

  const tokenRes = await fetch(
    `${MS_AUTH_BASE}/${encodeURIComponent(tenant.microsoftTenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: tenant.provisionedAppId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
        scope: "https://graph.microsoft.com/.default",
      }),
    },
  );

  const data = (await tokenRes.json()) as Record<string, unknown>;
  if (!tokenRes.ok) {
    log.error(
      { status: tokenRes.status, error: data.error, desc: data.error_description },
      "Admin console token request failed",
    );
    throw new Error("Nao foi possivel autenticar no Microsoft Graph para este tenant.");
  }

  return data.access_token as string;
}

async function graphRequest<T>(
  token: string,
  method: GraphMethod,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body == null ? undefined : JSON.stringify(body),
  });

  if (res.status === 204) return null as T;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(graphErrorMessage(res.status, data));
  }

  return data as T;
}

async function tryCreateServicePrincipalForApp(token: string, appId: string): Promise<void> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await graphRequest(token, "POST", "/servicePrincipals", { appId });
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("already exists") || message.includes("object references already exist")) {
        return;
      }

      if (attempt === 4) {
        log.warn({ appId, error: message }, "Service principal creation skipped after app creation");
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }
}

async function withTenantToken(
  customerId: string,
  tenantId: string,
  res: Response,
): Promise<string | null> {
  const tenant = await getTenantForCustomer(customerId, tenantId);
  if (!tenant) {
    res.status(404).json({ error: "Tenant nao encontrado." });
    return null;
  }

  if (tenant.status !== "connected") {
    res.status(400).json({ error: "Tenant nao esta conectado." });
    return null;
  }

  try {
    return await getTenantAccessToken(tenant);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: msg });
    return null;
  }
}

router.get("/admin-console/tenants", requireAuth, async (req, res): Promise<void> => {
  const customer = req.customer!;
  const tenants = await db
    .select({
      id: microsoftTenantsTable.id,
      microsoftTenantId: microsoftTenantsTable.microsoftTenantId,
      displayName: microsoftTenantsTable.displayName,
      primaryDomain: microsoftTenantsTable.primaryDomain,
      status: microsoftTenantsTable.status,
      updatedAt: microsoftTenantsTable.updatedAt,
    })
    .from(microsoftTenantsTable)
    .where(eq(microsoftTenantsTable.customerId, customer.id))
    .orderBy(desc(microsoftTenantsTable.createdAt));

  res.json(tenants);
});

router.get(
  "/admin-console/tenants/:tenantId/permissions",
  requireAuth,
  async (req, res): Promise<void> => {
    const tenant = await getTenantForCustomer(req.customer!.id, routeParam(req.params.tenantId));
    if (!tenant) {
      res.status(404).json({ error: "Tenant nao encontrado." });
      return;
    }

    if (tenant.status !== "connected") {
      res.status(400).json({ error: "Tenant nao esta conectado." });
      return;
    }

    try {
      const token = await getTenantAccessToken(tenant);
      const roles = decodeTokenRoles(token);
      const missingRoles = REQUIRED_ADMIN_CONSOLE_ROLES.filter((role) => !roles.includes(role));

      res.json({
        roles,
        requiredRoles: REQUIRED_ADMIN_CONSOLE_ROLES,
        missingRoles,
        ready: missingRoles.length === 0,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: msg });
    }
  },
);

router.get(
  "/admin-console/tenants/:tenantId/users",
  requireAuth,
  async (req, res): Promise<void> => {
    const token = await withTenantToken(req.customer!.id, routeParam(req.params.tenantId), res);
    if (!token) return;

    try {
      const search = asString(req.query.search);
      const filter = search
        ? `&$filter=startsWith(displayName,'${search.replace(/'/g, "''")}') or startsWith(userPrincipalName,'${search.replace(/'/g, "''")}')`
        : "";
      const data = await graphRequest(token, "GET", `/users?$top=50${filter}&$select=id,displayName,userPrincipalName,mail,accountEnabled,jobTitle,department`);
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.post(
  "/admin-console/tenants/:tenantId/users",
  requireAuth,
  async (req, res): Promise<void> => {
    const token = await withTenantToken(req.customer!.id, routeParam(req.params.tenantId), res);
    if (!token) return;

    const displayName = asString(req.body.displayName);
    const userPrincipalName = asString(req.body.userPrincipalName);
    const mailNickname = asString(req.body.mailNickname);
    const password = asString(req.body.password);

    if (!displayName || !userPrincipalName || !mailNickname || !password) {
      res.status(400).json({ error: "Nome, UPN, mail nickname e senha temporaria sao obrigatorios." });
      return;
    }

    try {
      const data = await graphRequest(token, "POST", "/users", {
        accountEnabled: true,
        displayName,
        userPrincipalName,
        mailNickname,
        passwordProfile: {
          forceChangePasswordNextSignIn: true,
          password,
        },
      });
      res.status(201).json(data);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.patch(
  "/admin-console/tenants/:tenantId/users/:userId",
  requireAuth,
  async (req, res): Promise<void> => {
    const token = await withTenantToken(req.customer!.id, routeParam(req.params.tenantId), res);
    if (!token) return;

    const body: Record<string, unknown> = {};
    for (const key of ["displayName", "jobTitle", "department"] as const) {
      const value = asString(req.body[key]);
      if (value) body[key] = value;
    }
    const accountEnabled = asBoolean(req.body.accountEnabled);
    if (accountEnabled !== null) body.accountEnabled = accountEnabled;

    if (asString(req.body.password)) {
      body.passwordProfile = {
        forceChangePasswordNextSignIn: true,
        password: asString(req.body.password),
      };
    }

    if (Object.keys(body).length === 0) {
      res.status(400).json({ error: "Nenhum campo para atualizar." });
      return;
    }

    try {
      await graphRequest(
        token,
        "PATCH",
        `/users/${encodeURIComponent(routeParam(req.params.userId))}`,
        body,
      );
      res.sendStatus(204);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.delete(
  "/admin-console/tenants/:tenantId/users/:userId",
  requireAuth,
  async (req, res): Promise<void> => {
    const token = await withTenantToken(req.customer!.id, routeParam(req.params.tenantId), res);
    if (!token) return;

    try {
      await graphRequest(token, "DELETE", `/users/${encodeURIComponent(routeParam(req.params.userId))}`);
      res.sendStatus(204);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.get(
  "/admin-console/tenants/:tenantId/groups",
  requireAuth,
  async (req, res): Promise<void> => {
    const token = await withTenantToken(req.customer!.id, routeParam(req.params.tenantId), res);
    if (!token) return;

    try {
      const data = await graphRequest(token, "GET", "/groups?$top=50&$select=id,displayName,mail,mailEnabled,securityEnabled,description");
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.post(
  "/admin-console/tenants/:tenantId/groups",
  requireAuth,
  async (req, res): Promise<void> => {
    const token = await withTenantToken(req.customer!.id, routeParam(req.params.tenantId), res);
    if (!token) return;

    const displayName = asString(req.body.displayName);
    const mailNickname = asString(req.body.mailNickname);
    if (!displayName || !mailNickname) {
      res.status(400).json({ error: "Nome e mail nickname sao obrigatorios." });
      return;
    }

    try {
      const data = await graphRequest(token, "POST", "/groups", {
        displayName,
        mailNickname,
        mailEnabled: false,
        securityEnabled: true,
        description: asString(req.body.description),
      });
      res.status(201).json(data);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.patch(
  "/admin-console/tenants/:tenantId/groups/:groupId",
  requireAuth,
  async (req, res): Promise<void> => {
    const token = await withTenantToken(req.customer!.id, routeParam(req.params.tenantId), res);
    if (!token) return;

    const body: Record<string, unknown> = {};
    const displayName = asString(req.body.displayName);
    const description = asString(req.body.description);
    if (displayName) body.displayName = displayName;
    if (description) body.description = description;

    if (Object.keys(body).length === 0) {
      res.status(400).json({ error: "Nenhum campo para atualizar." });
      return;
    }

    try {
      await graphRequest(token, "PATCH", `/groups/${encodeURIComponent(routeParam(req.params.groupId))}`, body);
      res.sendStatus(204);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.post(
  "/admin-console/tenants/:tenantId/groups/:groupId/members",
  requireAuth,
  async (req, res): Promise<void> => {
    const token = await withTenantToken(req.customer!.id, routeParam(req.params.tenantId), res);
    if (!token) return;

    const userId = asString(req.body.userId);
    if (!userId) {
      res.status(400).json({ error: "Informe o UPN ou ID do usuario." });
      return;
    }

    try {
      const user = await graphRequest<{ id: string }>(token, "GET", `/users/${encodeURIComponent(userId)}?$select=id`);
      await graphRequest(token, "POST", `/groups/${encodeURIComponent(routeParam(req.params.groupId))}/members/$ref`, {
        "@odata.id": `${GRAPH_BASE}/directoryObjects/${user.id}`,
      });
      res.sendStatus(204);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.delete(
  "/admin-console/tenants/:tenantId/groups/:groupId/members/:userId",
  requireAuth,
  async (req, res): Promise<void> => {
    const token = await withTenantToken(req.customer!.id, routeParam(req.params.tenantId), res);
    if (!token) return;

    try {
      const user = await graphRequest<{ id: string }>(token, "GET", `/users/${encodeURIComponent(routeParam(req.params.userId))}?$select=id`);
      await graphRequest(token, "DELETE", `/groups/${encodeURIComponent(routeParam(req.params.groupId))}/members/${user.id}/$ref`);
      res.sendStatus(204);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.delete(
  "/admin-console/tenants/:tenantId/groups/:groupId",
  requireAuth,
  async (req, res): Promise<void> => {
    const token = await withTenantToken(req.customer!.id, routeParam(req.params.tenantId), res);
    if (!token) return;

    try {
      await graphRequest(token, "DELETE", `/groups/${encodeURIComponent(routeParam(req.params.groupId))}`);
      res.sendStatus(204);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.get(
  "/admin-console/tenants/:tenantId/applications",
  requireAuth,
  async (req, res): Promise<void> => {
    const token = await withTenantToken(req.customer!.id, routeParam(req.params.tenantId), res);
    if (!token) return;

    try {
      const data = await graphRequest(token, "GET", "/applications?$top=50&$select=id,appId,displayName,signInAudience,createdDateTime");
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.post(
  "/admin-console/tenants/:tenantId/applications",
  requireAuth,
  async (req, res): Promise<void> => {
    const token = await withTenantToken(req.customer!.id, routeParam(req.params.tenantId), res);
    if (!token) return;

    const displayName = asString(req.body.displayName);
    if (!displayName) {
      res.status(400).json({ error: "Nome do aplicativo e obrigatorio." });
      return;
    }

    try {
      const app = await graphRequest<{ id: string; appId: string }>(token, "POST", "/applications", {
        displayName,
        signInAudience: "AzureADMyOrg",
      });
      await tryCreateServicePrincipalForApp(token, app.appId);
      res.status(201).json(app);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.patch(
  "/admin-console/tenants/:tenantId/applications/:applicationId",
  requireAuth,
  async (req, res): Promise<void> => {
    const token = await withTenantToken(req.customer!.id, routeParam(req.params.tenantId), res);
    if (!token) return;

    const displayName = asString(req.body.displayName);
    if (!displayName) {
      res.status(400).json({ error: "Novo nome e obrigatorio." });
      return;
    }

    try {
      await graphRequest(token, "PATCH", `/applications/${encodeURIComponent(routeParam(req.params.applicationId))}`, { displayName });
      res.sendStatus(204);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.post(
  "/admin-console/tenants/:tenantId/applications/:applicationId/passwords",
  requireAuth,
  async (req, res): Promise<void> => {
    const token = await withTenantToken(req.customer!.id, routeParam(req.params.tenantId), res);
    if (!token) return;

    const displayName = asString(req.body.displayName) ?? "WNR-Audit Admin Console";
    try {
      const secret = await graphRequest(token, "POST", `/applications/${encodeURIComponent(routeParam(req.params.applicationId))}/addPassword`, {
        passwordCredential: {
          displayName,
          endDateTime: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        },
      });
      res.status(201).json(secret);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.delete(
  "/admin-console/tenants/:tenantId/applications/:applicationId",
  requireAuth,
  async (req, res): Promise<void> => {
    const token = await withTenantToken(req.customer!.id, routeParam(req.params.tenantId), res);
    if (!token) return;

    try {
      await graphRequest(token, "DELETE", `/applications/${encodeURIComponent(routeParam(req.params.applicationId))}`);
      res.sendStatus(204);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.get(
  "/admin-console/tenants/:tenantId/files/search",
  requireAuth,
  async (req, res): Promise<void> => {
    const token = await withTenantToken(req.customer!.id, routeParam(req.params.tenantId), res);
    if (!token) return;

    const query = asString(req.query.q);
    if (!query) {
      res.json({ value: [] });
      return;
    }

    type DriveItem = {
      id?: string;
      name?: string;
      webUrl?: string;
      size?: number;
      lastModifiedDateTime?: string;
      file?: { mimeType?: string };
      folder?: Record<string, unknown>;
      parentReference?: { driveId?: string; siteId?: string; path?: string };
    };

    try {
      const encoded = encodeURIComponent(query);
      let firstError: string | null = null;

      // Collect drives from all SharePoint sites, including communication sites
      // (which are NOT linked to M365 Groups and are invisible to /sites?search=* in app-only context).
      const driveIdSet = new Set<string>();

      const addDrivesFromSites = async (siteIds: string[]) => {
        const results = await Promise.allSettled(
          siteIds.map((siteId) =>
            graphRequest<{ value?: Array<{ id?: string }> }>(
              token,
              "GET",
              `/sites/${siteId}/drives?$select=id`,
            ).catch((e: unknown) => {
              if (!firstError) firstError = e instanceof Error ? e.message : String(e);
              return null;
            }),
          ),
        );
        for (const r of results) {
          if (r.status === "fulfilled" && r.value?.value) {
            for (const d of r.value.value) {
              if (d.id) driveIdSet.add(d.id);
            }
          }
        }
      };

      // Primary: getAllSites returns every site collection regardless of type —
      // team sites, communication sites, hub sites, classic sites.
      // This is the only reliable way to reach communication sites in app-only context.
      const allSitesResult = await graphRequest<{ value?: Array<{ id?: string }> }>(
        token,
        "GET",
        "/sites/getAllSites?$select=id&$top=500",
      ).catch(() => null);

      const allSiteIds = (allSitesResult?.value ?? []).map((s) => s.id).filter(Boolean) as string[];

      if (allSiteIds.length > 0) {
        await addDrivesFromSites(allSiteIds);
      } else {
        // Fallback when getAllSites is unavailable: root + search=* + M365 Group drives
        const [rootSiteResult, groupsResult, searchSitesResult] = await Promise.allSettled([
          graphRequest<{ id?: string }>(token, "GET", "/sites/root?$select=id"),
          graphRequest<{ value?: Array<{ id: string }> }>(
            token,
            "GET",
            "/groups?$filter=groupTypes/any(c:c%20eq%20'Unified')&$select=id&$top=200",
          ),
          graphRequest<{ value?: Array<{ id?: string }> }>(
            token,
            "GET",
            "/sites?search=*&$select=id&$top=100",
          ),
        ]);

        const fallbackSiteIds = new Set<string>();
        if (rootSiteResult.status === "fulfilled" && rootSiteResult.value.id) {
          fallbackSiteIds.add(rootSiteResult.value.id);
        }
        if (searchSitesResult.status === "fulfilled") {
          for (const s of searchSitesResult.value.value ?? []) {
            if (s.id) fallbackSiteIds.add(s.id);
          }
        }
        if (fallbackSiteIds.size > 0) await addDrivesFromSites(Array.from(fallbackSiteIds));

        const groups = groupsResult.status === "fulfilled" ? (groupsResult.value.value ?? []) : [];
        if (groups.length > 0) {
          const groupDriveResults = await Promise.allSettled(
            groups.map((g) =>
              graphRequest<{ value?: Array<{ id?: string }> }>(
                token,
                "GET",
                `/groups/${g.id}/drives?$select=id`,
              ).catch(() => null),
            ),
          );
          for (const r of groupDriveResults) {
            if (r.status === "fulfilled" && r.value?.value) {
              for (const d of r.value.value) {
                if (d.id) driveIdSet.add(d.id);
              }
            }
          }
        }
      }

      const driveIds = Array.from(driveIdSet);

      // Search all collected drives in parallel
      const driveSearchResults = await Promise.allSettled(
        driveIds.map((driveId) =>
          graphRequest<{ value?: DriveItem[] }>(
            token,
            "GET",
            `/drives/${driveId}/root/search(q='${encoded}')?$select=id,name,webUrl,size,lastModifiedDateTime,file,folder,parentReference&$top=50`,
          ).then((d) => d.value ?? []),
        ),
      );

      for (const r of driveSearchResults) {
        if (r.status === "rejected" && !firstError) {
          firstError = r.reason instanceof Error ? r.reason.message : String(r.reason);
        }
      }

      const seen = new Set<string>();
      const value = driveSearchResults
        .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
        .filter((item): item is DriveItem & { id: string; name: string } => {
          if (!item.id || !item.name) return false;
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        })
        .map((item) => ({
          id: item.id,
          name: item.name,
          webUrl: item.webUrl ?? null,
          size: item.size ?? null,
          lastModifiedDateTime: item.lastModifiedDateTime ?? null,
          mimeType: item.file?.mimeType ?? null,
          isFolder: Boolean(item.folder),
          driveId: item.parentReference?.driveId ?? null,
          siteId: item.parentReference?.siteId ?? null,
          path: item.parentReference?.path ?? null,
        }));

      if (value.length === 0 && firstError) {
        res.status(502).json({ error: firstError });
        return;
      }

      res.json({ value });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.post(
  "/admin-console/tenants/:tenantId/files/preview",
  requireAuth,
  async (req, res): Promise<void> => {
    const token = await withTenantToken(req.customer!.id, routeParam(req.params.tenantId), res);
    if (!token) return;

    const driveId = asString(req.body.driveId);
    const itemId = asString(req.body.itemId);
    if (!driveId || !itemId) {
      res.status(400).json({ error: "driveId e itemId sao obrigatorios." });
      return;
    }

    try {
      const preview = await graphRequest(token, "POST", `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/preview`, {
        viewer: "onedrive",
      });
      res.json(preview);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

export default router;
