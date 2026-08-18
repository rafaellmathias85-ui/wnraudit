import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  serverDevicesTable,
  deviceScansTable,
  deviceFindingsTable,
  probeRegistrationsTable,
  probeScanJobsTable,
} from "@workspace/db";
import { schemas } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { runServerScan, buildServerControls } from "../lib/serverScanner";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/servers", requireAuth, async (req, res): Promise<void> => {
  const customer = req.customer!;
  const devices = await db
    .select()
    .from(serverDevicesTable)
    .where(eq(serverDevicesTable.customerId, customer.id))
    .orderBy(desc(serverDevicesTable.createdAt));
  res.json(schemas.ListServersResponse.parse(devices));
});

router.post("/servers", requireAuth, async (req, res): Promise<void> => {
  const parsed = schemas.CreateServerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const customer = req.customer!;

  const [device] = await db
    .insert(serverDevicesTable)
    .values({
      customerId: customer.id,
      name: parsed.data.name,
      hostname: parsed.data.hostname,
      os: parsed.data.os,
      osVersion: parsed.data.osVersion ?? null,
      ipAddress: parsed.data.ipAddress ?? null,
      role: parsed.data.role ?? null,
      notes: parsed.data.notes ?? null,
    })
    .returning();

  res.status(201).json(schemas.ListServersResponseItem.parse(device));
});

router.get(
  "/servers/:deviceId",
  requireAuth,
  async (req, res): Promise<void> => {
    const customer = req.customer!;
    const deviceId = req.params.deviceId as string;

    const [device] = await db
      .select()
      .from(serverDevicesTable)
      .where(
        and(
          eq(serverDevicesTable.id, deviceId),
          eq(serverDevicesTable.customerId, customer.id),
        ),
      )
      .limit(1);

    if (!device) {
      res.status(404).json({ error: "Servidor não encontrado" });
      return;
    }

    const recentScans = await db
      .select()
      .from(deviceScansTable)
      .where(
        and(
          eq(deviceScansTable.deviceId, deviceId),
          eq(deviceScansTable.deviceType, "server"),
        ),
      )
      .orderBy(desc(deviceScansTable.startedAt))
      .limit(10);

    res.json(schemas.GetServerResponse.parse({ ...device, recentScans }));
  },
);

router.delete(
  "/servers/:deviceId",
  requireAuth,
  async (req, res): Promise<void> => {
    const customer = req.customer!;
    const deviceId = req.params.deviceId as string;

    const [deleted] = await db
      .delete(serverDevicesTable)
      .where(
        and(
          eq(serverDevicesTable.id, deviceId),
          eq(serverDevicesTable.customerId, customer.id),
        ),
      )
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Servidor não encontrado" });
      return;
    }
    res.sendStatus(204);
  },
);

router.get(
  "/servers/:deviceId/scans",
  requireAuth,
  async (req, res): Promise<void> => {
    const customer = req.customer!;
    const deviceId = req.params.deviceId as string;

    const [device] = await db
      .select()
      .from(serverDevicesTable)
      .where(
        and(
          eq(serverDevicesTable.id, deviceId),
          eq(serverDevicesTable.customerId, customer.id),
        ),
      )
      .limit(1);

    if (!device) {
      res.status(404).json({ error: "Servidor não encontrado" });
      return;
    }

    const scans = await db
      .select()
      .from(deviceScansTable)
      .where(
        and(
          eq(deviceScansTable.deviceId, deviceId),
          eq(deviceScansTable.deviceType, "server"),
        ),
      )
      .orderBy(desc(deviceScansTable.startedAt));

    res.json(schemas.ListServerScansResponse.parse(scans));
  },
);

router.post(
  "/servers/:deviceId/scans",
  requireAuth,
  async (req, res): Promise<void> => {
    const customer = req.customer!;
    const deviceId = req.params.deviceId as string;

    const [device] = await db
      .select()
      .from(serverDevicesTable)
      .where(
        and(
          eq(serverDevicesTable.id, deviceId),
          eq(serverDevicesTable.customerId, customer.id),
        ),
      )
      .limit(1);

    if (!device) {
      res.status(404).json({ error: "Servidor não encontrado" });
      return;
    }

    // Check for an online probe for this customer
    const [onlineProbe] = await db
      .select({ id: probeRegistrationsTable.id })
      .from(probeRegistrationsTable)
      .where(
        and(
          eq(probeRegistrationsTable.customerId, customer.id),
          eq(probeRegistrationsTable.status, "online"),
        ),
      )
      .limit(1);

    const useProbe = onlineProbe && device.ipAddress;

    const [scan] = await db
      .insert(deviceScansTable)
      .values({
        deviceId,
        deviceType: "server",
        status: useProbe ? "pending" : "running",
        startedAt: new Date(),
      })
      .returning();

    if (useProbe) {
      await db.insert(probeScanJobsTable).values({
        probeId: onlineProbe.id,
        deviceScanId: scan.id,
        deviceId,
        deviceType: "server",
        targetIp: device.ipAddress!,
        targetHostname: device.hostname ?? null,
        status: "queued",
      });
      logger.info({ scanId: scan.id, probeId: onlineProbe.id }, "Server scan queued for probe");
    } else {
      runServerScan(scan.id)
        .then(() =>
          db
            .update(serverDevicesTable)
            .set({ lastScanAt: new Date(), updatedAt: new Date() })
            .where(eq(serverDevicesTable.id, deviceId)),
        )
        .catch((err) => {
          logger.error({ err, scanId: scan.id }, "Server scan failed");
          db.update(deviceScansTable)
            .set({ status: "failed", completedAt: new Date() })
            .where(eq(deviceScansTable.id, scan.id))
            .catch(() => {});
        });
    }

    res.status(201).json(schemas.ListServerScansResponseItem.parse(scan));
  },
);

router.get(
  "/server-scans/:scanId",
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
          eq(deviceScansTable.deviceType, "server"),
        ),
      )
      .limit(1);

    if (!scan) {
      res.status(404).json({ error: "Varredura não encontrada" });
      return;
    }

    const [device] = await db
      .select()
      .from(serverDevicesTable)
      .where(
        and(
          eq(serverDevicesTable.id, scan.deviceId),
          eq(serverDevicesTable.customerId, customer.id),
        ),
      )
      .limit(1);

    if (!device) {
      res.status(404).json({ error: "Varredura não encontrada" });
      return;
    }

    const findings = await db
      .select()
      .from(deviceFindingsTable)
      .where(eq(deviceFindingsTable.deviceScanId, scanId))
      .orderBy(desc(deviceFindingsTable.detectedAt));

    const controls = buildServerControls(
      findings
        .filter((f) => f.status !== "resolved" && f.status !== "ignored")
        .map((f) => ({ id: f.id, controlId: f.controlId })),
    );

    res.json(
      schemas.GetServerScanResponse.parse({
        ...scan,
        deviceName: device.name,
        deviceType: "server" as const,
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
