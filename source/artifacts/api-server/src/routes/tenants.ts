import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  microsoftTenantsTable,
  scansTable,
  findingsTable,
} from "@workspace/db";
import { schemas } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import {
  buildAdminConsentUrl,
  createSignedState,
  getWnrAuditOAuthClientId,
} from "../lib/oauth";
import {
  validateAndConnectWithApp,
  encryptSecret,
} from "../lib/msProvisioner";

const router: IRouter = Router();

async function tenantWithCounts(
  customerId: string,
  tenantId?: string,
): Promise<
  Array<{
    id: string;
    microsoftTenantId: string;
    displayName: string;
    primaryDomain: string | null;
    scope: "m365" | "azure" | "both";
    status: "pending" | "connected" | "error" | "disconnected";
    lastScanAt: Date | null;
    openFindingsCount: number;
    criticalFindingsCount: number;
    createdAt: Date;
  }>
> {
  const where = tenantId
    ? and(
        eq(microsoftTenantsTable.customerId, customerId),
        eq(microsoftTenantsTable.id, tenantId),
      )
    : eq(microsoftTenantsTable.customerId, customerId);

  const tenants = await db
    .select()
    .from(microsoftTenantsTable)
    .where(where)
    .orderBy(desc(microsoftTenantsTable.createdAt));

  if (tenants.length === 0) return [];

  const ids = tenants.map((t) => t.id);

  const counts = await db
    .select({
      tenantId: scansTable.tenantId,
      open: sql<number>`COUNT(*) FILTER (WHERE ${findingsTable.status} = 'open')::int`,
      critical: sql<number>`COUNT(*) FILTER (WHERE ${findingsTable.status} = 'open' AND ${findingsTable.severity} = 'critical')::int`,
    })
    .from(findingsTable)
    .innerJoin(scansTable, eq(scansTable.id, findingsTable.scanId))
    .where(inArray(scansTable.tenantId, ids))
    .groupBy(scansTable.tenantId);

  const countMap = new Map<string, { open: number; critical: number }>();
  for (const c of counts) {
    countMap.set(c.tenantId, { open: c.open, critical: c.critical });
  }

  return tenants.map((t) => ({
    id: t.id,
    microsoftTenantId: t.microsoftTenantId,
    displayName: t.displayName,
    primaryDomain: t.primaryDomain,
    scope: t.scope,
    status: t.status,
    lastScanAt: t.lastScanAt,
    openFindingsCount: countMap.get(t.id)?.open ?? 0,
    criticalFindingsCount: countMap.get(t.id)?.critical ?? 0,
    createdAt: t.createdAt,
  }));
}

router.get("/tenants", requireAuth, async (req, res): Promise<void> => {
  const customer = req.customer!;
  const tenants = await tenantWithCounts(customer.id);
  res.json(schemas.ListTenantsResponse.parse(tenants));
});

router.post("/tenants", requireAuth, async (req, res): Promise<void> => {
  const parsed = schemas.CreateTenantBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const customer = req.customer!;
  const normalizedMsTenantId = parsed.data.microsoftTenantId.trim().toLowerCase();
  const normalizedDomain = parsed.data.primaryDomain
    ? parsed.data.primaryDomain.trim().toLowerCase()
    : null;

  // Detect duplicate: same microsoftTenantId or primaryDomain already registered.
  const [duplicate] = await db
    .select({
      id: microsoftTenantsTable.id,
      displayName: microsoftTenantsTable.displayName,
      microsoftTenantId: microsoftTenantsTable.microsoftTenantId,
      primaryDomain: microsoftTenantsTable.primaryDomain,
    })
    .from(microsoftTenantsTable)
    .where(
      and(
        eq(microsoftTenantsTable.customerId, customer.id),
        normalizedDomain
          ? sql`(LOWER(${microsoftTenantsTable.microsoftTenantId}) = ${normalizedMsTenantId} OR LOWER(${microsoftTenantsTable.primaryDomain}) = ${normalizedDomain})`
          : sql`LOWER(${microsoftTenantsTable.microsoftTenantId}) = ${normalizedMsTenantId}`,
      ),
    )
    .limit(1);

  if (duplicate) {
    const matchedBy =
      duplicate.microsoftTenantId.toLowerCase() === normalizedMsTenantId
        ? "Tenant ID"
        : "domínio principal";
    res.status(409).json({
      error: `Este ambiente já foi registrado (${matchedBy} igual ao tenant "${duplicate.displayName}"). Edite ou remova o existente antes de criar um novo.`,
    });
    return;
  }

  const [tenant] = await db
    .insert(microsoftTenantsTable)
    .values({
      customerId: customer.id,
      microsoftTenantId: normalizedMsTenantId,
      displayName: parsed.data.displayName.trim(),
      primaryDomain: normalizedDomain,
      scope: parsed.data.scope,
      status: "pending",
      provisioningStatus: "idle",
    })
    .returning();

  res.status(201).json(
    schemas.ListTenantsResponseItem.parse({
      id: tenant.id,
      microsoftTenantId: tenant.microsoftTenantId,
      displayName: tenant.displayName,
      primaryDomain: tenant.primaryDomain,
      scope: tenant.scope,
      status: tenant.status,
      lastScanAt: tenant.lastScanAt,
      openFindingsCount: 0,
      criticalFindingsCount: 0,
      createdAt: tenant.createdAt,
    }),
  );
});

router.get(
  "/tenants/:tenantId",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = schemas.GetTenantParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const customer = req.customer!;
    const [tenant] = await tenantWithCounts(customer.id, params.data.tenantId);
    if (!tenant) {
      res.status(404).json({ error: "Tenant não encontrado" });
      return;
    }

    const recentScans = await db
      .select()
      .from(scansTable)
      .where(eq(scansTable.tenantId, tenant.id))
      .orderBy(desc(scansTable.startedAt))
      .limit(10);

    res.json(
      schemas.GetTenantResponse.parse({
        ...tenant,
        recentScans: recentScans.map((s) => ({ ...s })),
      }),
    );
  },
);

router.delete(
  "/tenants/:tenantId",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = schemas.DeleteTenantParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const customer = req.customer!;
    const [deleted] = await db
      .delete(microsoftTenantsTable)
      .where(
        and(
          eq(microsoftTenantsTable.id, params.data.tenantId),
          eq(microsoftTenantsTable.customerId, customer.id),
        ),
      )
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Tenant não encontrado" });
      return;
    }
    res.sendStatus(204);
  },
);


router.post(
  "/tenants/:tenantId/provision/app",
  requireAuth,
  async (req, res): Promise<void> => {
    const tenantId = req.params.tenantId as string;
    const customer = req.customer!;

    const parsed = schemas.ConnectTenantWithAppBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "clientId e clientSecret são obrigatórios." });
      return;
    }

    const { clientId, clientSecret } = parsed.data;

    const [tenant] = await db
      .select()
      .from(microsoftTenantsTable)
      .where(
        and(
          eq(microsoftTenantsTable.id, tenantId),
          eq(microsoftTenantsTable.customerId, customer.id),
        ),
      )
      .limit(1);

    if (!tenant) {
      res.status(404).json({ error: "Tenant não encontrado" });
      return;
    }

    try {
      await validateAndConnectWithApp(tenant.microsoftTenantId, clientId, clientSecret);

      const encryptedSecret = encryptSecret(clientSecret);

      await db
        .update(microsoftTenantsTable)
        .set({
          provisionedAppId: clientId,
          encryptedClientSecret: encryptedSecret,
          provisioningStatus: "completed",
          status: "connected",
          lastErrorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(microsoftTenantsTable.id, tenant.id));

      res.json(schemas.PollTenantProvisionResponse.parse({
        status: "completed",
        permissionsGranted: [],
        permissionsFailed: [],
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao conectar com a Microsoft";
      await db
        .update(microsoftTenantsTable)
        .set({ lastErrorMessage: msg, updatedAt: new Date() })
        .where(eq(microsoftTenantsTable.id, tenant.id));
      res.status(502).json({ error: msg });
    }
  },
);


router.post(
  "/tenants/:tenantId/reconnect",
  requireAuth,
  async (req, res) => {
    const tenantId = req.params.tenantId as string;
    const customer = req.customer!;

    const [tenant] = await db
      .select()
      .from(microsoftTenantsTable)
      .where(
        and(
          eq(microsoftTenantsTable.id, tenantId),
          eq(microsoftTenantsTable.customerId, customer.id),
        ),
      )
      .limit(1);

    if (!tenant) {
      res.status(404).json({ error: "Tenant não encontrado." });
      return;
    }

    await db
      .update(microsoftTenantsTable)
      .set({
        status: "pending",
        provisioningStatus: "idle",
        provisionedAppId: null,
        provisionedAppObjectId: null,
        encryptedClientSecret: null,
        deviceCodeFlowJson: null,
        lastErrorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(microsoftTenantsTable.id, tenantId));

    const [updated] = await tenantWithCounts(customer.id, tenantId);
    res.json(updated);
  },
);

// POST /tenants/:tenantId/provision/oauth/start
// Gera a URL de admin consent da Microsoft para o tenant informado.
// Requer que MS_OAUTH_CLIENT_ID esteja configurado.
router.post(
  "/tenants/:tenantId/provision/oauth/start",
  requireAuth,
  async (req, res) => {
    const tenantId = req.params.tenantId as string;
    const customer = req.customer!;

    const [tenant] = await db
      .select()
      .from(microsoftTenantsTable)
      .where(
        and(
          eq(microsoftTenantsTable.id, tenantId),
          eq(microsoftTenantsTable.customerId, customer.id),
        ),
      )
      .limit(1);

    if (!tenant) {
      res.status(404).json({ error: "Tenant não encontrado." });
      return;
    }

    let clientId: string;
    try {
      clientId = getWnrAuditOAuthClientId();
    } catch {
      res.status(503).json({ error: "Integração Microsoft OAuth não configurada. Contate o suporte WNR-Audit." });
      return;
    }
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(clientId)) {
      res.status(503).json({ error: "Client ID Microsoft OAuth inválido (placeholder não substituído). Contate o suporte WNR-Audit." });
      return;
    }

    const state = createSignedState(tenantId, customer.id);
    const authUrl = buildAdminConsentUrl({
      microsoftTenantId: tenant.microsoftTenantId,
      state,
    });

    res.json({ authUrl });
  },
);

export default router;

