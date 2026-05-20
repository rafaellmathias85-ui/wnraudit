import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  externalAssetsTable,
  deviceScansTable,
  deviceFindingsTable,
} from "@workspace/db";
import { schemas } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { runExternalScan } from "../lib/externalScanner";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/external-assets", requireAuth, async (req, res): Promise<void> => {
  const customer = req.customer!;
  const rows = await db
    .select()
    .from(externalAssetsTable)
    .where(eq(externalAssetsTable.customerId, customer.id))
    .orderBy(desc(externalAssetsTable.createdAt));
  res.json(schemas.ListExternalAssetsResponse.parse(rows));
});

router.post(
  "/external-assets",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = schemas.CreateExternalAssetBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const customer = req.customer!;
    const [created] = await db
      .insert(externalAssetsTable)
      .values({
        customerId: customer.id,
        name: parsed.data.name,
        kind: parsed.data.kind,
        host: parsed.data.host,
        port: parsed.data.port ?? null,
        notes: parsed.data.notes ?? null,
      })
      .returning();
    res
      .status(201)
      .json(schemas.ListExternalAssetsResponseItem.parse(created));
  },
);

router.get(
  "/external-assets/:assetId",
  requireAuth,
  async (req, res): Promise<void> => {
    const customer = req.customer!;
    const assetId = req.params.assetId as string;

    const [asset] = await db
      .select()
      .from(externalAssetsTable)
      .where(
        and(
          eq(externalAssetsTable.id, assetId),
          eq(externalAssetsTable.customerId, customer.id),
        ),
      )
      .limit(1);
    if (!asset) {
      res.status(404).json({ error: "Ativo não encontrado" });
      return;
    }

    const recentScans = await db
      .select()
      .from(deviceScansTable)
      .where(
        and(
          eq(deviceScansTable.deviceId, assetId),
          eq(deviceScansTable.deviceType, "external"),
        ),
      )
      .orderBy(desc(deviceScansTable.startedAt))
      .limit(10);

    res.json(
      schemas.GetExternalAssetResponse.parse({ ...asset, recentScans }),
    );
  },
);

router.delete(
  "/external-assets/:assetId",
  requireAuth,
  async (req, res): Promise<void> => {
    const customer = req.customer!;
    const assetId = req.params.assetId as string;
    const [deleted] = await db
      .delete(externalAssetsTable)
      .where(
        and(
          eq(externalAssetsTable.id, assetId),
          eq(externalAssetsTable.customerId, customer.id),
        ),
      )
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Ativo não encontrado" });
      return;
    }
    res.sendStatus(204);
  },
);

router.get(
  "/external-assets/:assetId/scans",
  requireAuth,
  async (req, res): Promise<void> => {
    const customer = req.customer!;
    const assetId = req.params.assetId as string;

    const [asset] = await db
      .select()
      .from(externalAssetsTable)
      .where(
        and(
          eq(externalAssetsTable.id, assetId),
          eq(externalAssetsTable.customerId, customer.id),
        ),
      )
      .limit(1);
    if (!asset) {
      res.status(404).json({ error: "Ativo não encontrado" });
      return;
    }

    const scans = await db
      .select()
      .from(deviceScansTable)
      .where(
        and(
          eq(deviceScansTable.deviceId, assetId),
          eq(deviceScansTable.deviceType, "external"),
        ),
      )
      .orderBy(desc(deviceScansTable.startedAt));

    res.json(schemas.ListExternalAssetScansResponse.parse(scans));
  },
);

router.post(
  "/external-assets/:assetId/scans",
  requireAuth,
  async (req, res): Promise<void> => {
    const customer = req.customer!;
    const assetId = req.params.assetId as string;

    const [asset] = await db
      .select()
      .from(externalAssetsTable)
      .where(
        and(
          eq(externalAssetsTable.id, assetId),
          eq(externalAssetsTable.customerId, customer.id),
        ),
      )
      .limit(1);
    if (!asset) {
      res.status(404).json({ error: "Ativo não encontrado" });
      return;
    }

    // Bloqueia disparo concorrente para o mesmo ativo
    const [running] = await db
      .select({ id: deviceScansTable.id })
      .from(deviceScansTable)
      .where(
        and(
          eq(deviceScansTable.deviceId, assetId),
          eq(deviceScansTable.deviceType, "external"),
          eq(deviceScansTable.status, "running"),
        ),
      )
      .limit(1);
    if (running) {
      res.status(409).json({
        error: "Já existe uma varredura em andamento para este ativo",
      });
      return;
    }

    const [scan] = await db
      .insert(deviceScansTable)
      .values({
        deviceId: assetId,
        deviceType: "external",
        status: "running",
        startedAt: new Date(),
      })
      .returning();

    runExternalScan(scan.id).catch((err) => {
      logger.error({ err, scanId: scan.id }, "External scan failed");
      db.update(deviceScansTable)
        .set({ status: "failed", completedAt: new Date() })
        .where(eq(deviceScansTable.id, scan.id))
        .catch(() => {});
    });

    res
      .status(201)
      .json(schemas.ListExternalAssetScansResponseItem.parse(scan));
  },
);

router.get(
  "/external-scans/:scanId",
  requireAuth,
  async (req, res): Promise<void> => {
    const customer = req.customer!;
    const scanId = req.params.scanId as string;

    const [scan] = await db
      .select()
      .from(deviceScansTable)
      .where(
        and(
          eq(deviceScansTable.id, scanId),
          eq(deviceScansTable.deviceType, "external"),
        ),
      )
      .limit(1);
    if (!scan) {
      res.status(404).json({ error: "Varredura não encontrada" });
      return;
    }

    const [asset] = await db
      .select()
      .from(externalAssetsTable)
      .where(
        and(
          eq(externalAssetsTable.id, scan.deviceId),
          eq(externalAssetsTable.customerId, customer.id),
        ),
      )
      .limit(1);
    if (!asset) {
      res.status(404).json({ error: "Varredura não encontrada" });
      return;
    }

    const findings = await db
      .select()
      .from(deviceFindingsTable)
      .where(eq(deviceFindingsTable.deviceScanId, scanId))
      .orderBy(desc(deviceFindingsTable.detectedAt));

    const controls = findings
      .filter((f) => f.status !== "resolved" && f.status !== "ignored")
      .map((f) => ({
        controlId: f.controlId,
        title: f.title,
        category: f.category,
        severity: f.severity,
        affectedResource: f.affectedResource ?? null,
        recommendation:
          (f.remediation as string | null | undefined) ??
          "Veja o detalhe da vulnerabilidade.",
        status: "failed" as const,
        findingId: f.id,
      }));

    res.json(
      schemas.GetExternalScanResponse.parse({
        ...scan,
        deviceName: asset.name,
        deviceType: "external" as const,
        findings: findings.map((f) => ({
          id: f.id,
          deviceScanId: f.deviceScanId,
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
  },
);

export default router;
