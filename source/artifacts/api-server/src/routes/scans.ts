import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  microsoftTenantsTable,
  scansTable,
  findingsTable,
} from "@workspace/db";
import { schemas } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { runScanForTenant, buildControlsForScan } from "../lib/scanRunner";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get(
  "/tenants/:tenantId/scans",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = schemas.ListTenantScansParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const customer = req.customer!;
    const [tenant] = await db
      .select()
      .from(microsoftTenantsTable)
      .where(
        and(
          eq(microsoftTenantsTable.id, params.data.tenantId),
          eq(microsoftTenantsTable.customerId, customer.id),
        ),
      )
      .limit(1);
    if (!tenant) {
      res.status(404).json({ error: "Tenant não encontrado" });
      return;
    }
    const scans = await db
      .select()
      .from(scansTable)
      .where(eq(scansTable.tenantId, tenant.id))
      .orderBy(desc(scansTable.startedAt));
    res.json(schemas.ListTenantScansResponse.parse(scans));
  },
);

router.post(
  "/tenants/:tenantId/scans",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = schemas.StartTenantScanParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const customer = req.customer!;
    const [tenant] = await db
      .select()
      .from(microsoftTenantsTable)
      .where(
        and(
          eq(microsoftTenantsTable.id, params.data.tenantId),
          eq(microsoftTenantsTable.customerId, customer.id),
        ),
      )
      .limit(1);
    if (!tenant) {
      res.status(404).json({ error: "Tenant não encontrado" });
      return;
    }

    const body = schemas.StartTenantScanBody.safeParse(req.body ?? {});
    const scanMode = body.success ? (body.data.mode ?? "simple") : "simple";

    if (scanMode === "advanced") {
      // Advanced scan requires the tenant to be fully provisioned with real credentials
      if (tenant.provisioningStatus !== "completed" || tenant.status !== "connected") {
        res.status(409).json({
          error: "Varredura avançada requer que o tenant esteja conectado com credenciais Microsoft. Use 'Reconectar' para provisionar primeiro.",
        });
        return;
      }
    }

    // Varredura simples não requer conexão — não alterar o status do tenant

    const [scan] = await db
      .insert(scansTable)
      .values({
        tenantId: tenant.id,
        status: "running",
        startedAt: new Date(),
        scanMode,
      })
      .returning();

    runScanForTenant(scan.id)
      .then(async () => {
        await db
          .update(microsoftTenantsTable)
          .set({ lastScanAt: new Date(), updatedAt: new Date() })
          .where(eq(microsoftTenantsTable.id, tenant.id));
      })
      .catch((err) => {
        logger.error({ err, scanId: scan.id }, "Scan failed");
        db.update(scansTable)
          .set({ status: "failed", completedAt: new Date() })
          .where(eq(scansTable.id, scan.id))
          .catch((updateErr) =>
            logger.error({ err: updateErr }, "Failed to mark scan as failed"),
          );
      });

    res.status(201).json(schemas.ListTenantScansResponseItem.parse(scan));
  },
);

router.get("/scans/:scanId", requireAuth, async (req, res): Promise<void> => {
  const params = schemas.GetScanParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const customer = req.customer!;
  const [scan] = await db
    .select({
      scan: scansTable,
      tenant: microsoftTenantsTable,
    })
    .from(scansTable)
    .innerJoin(
      microsoftTenantsTable,
      eq(scansTable.tenantId, microsoftTenantsTable.id),
    )
    .where(
      and(
        eq(scansTable.id, params.data.scanId),
        eq(microsoftTenantsTable.customerId, customer.id),
      ),
    )
    .limit(1);

  if (!scan) {
    res.status(404).json({ error: "Varredura não encontrada" });
    return;
  }

  const findings = await db
    .select()
    .from(findingsTable)
    .where(eq(findingsTable.scanId, scan.scan.id))
    .orderBy(desc(findingsTable.detectedAt));

  const controls = buildControlsForScan(
    findings
      .filter((f) => f.status !== "resolved" && f.status !== "ignored")
      .map((f) => ({ id: f.id, controlId: f.controlId })),
  );

  res.json(
    schemas.GetScanResponse.parse({
      ...scan.scan,
      tenantName: scan.tenant.displayName,
      findings: findings.map((f) => ({
        id: f.id,
        scanId: f.scanId,
        controlId: f.controlId,
        title: f.title,
        category: f.category,
        severity: f.severity,
        status: f.status,
        affectedResource: f.affectedResource,
        detectedAt: f.detectedAt,
      })),
      controls,
    }),
  );
});

export default router;
