import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  firewallDevicesTable,
  deviceScansTable,
  deviceFindingsTable,
} from "@workspace/db";
import { schemas } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { runFirewallScan, buildFirewallControls } from "../lib/firewallScanner";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/firewalls", requireAuth, async (req, res): Promise<void> => {
  const customer = req.customer!;
  const devices = await db
    .select()
    .from(firewallDevicesTable)
    .where(eq(firewallDevicesTable.customerId, customer.id))
    .orderBy(desc(firewallDevicesTable.createdAt));
  res.json(schemas.ListFirewallsResponse.parse(devices));
});

router.post("/firewalls", requireAuth, async (req, res): Promise<void> => {
  const parsed = schemas.CreateFirewallBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const customer = req.customer!;

  const [device] = await db
    .insert(firewallDevicesTable)
    .values({
      customerId: customer.id,
      name: parsed.data.name,
      manufacturer: parsed.data.manufacturer,
      model: parsed.data.model ?? null,
      ipAddress: parsed.data.ipAddress ?? null,
      firmwareVersion: parsed.data.firmwareVersion ?? null,
      location: parsed.data.location ?? null,
      notes: parsed.data.notes ?? null,
    })
    .returning();

  res.status(201).json(schemas.ListFirewallsResponseItem.parse(device));
});

router.get(
  "/firewalls/:deviceId",
  requireAuth,
  async (req, res): Promise<void> => {
    const customer = req.customer!;
    const deviceId = req.params.deviceId as string;

    const [device] = await db
      .select()
      .from(firewallDevicesTable)
      .where(
        and(
          eq(firewallDevicesTable.id, deviceId),
          eq(firewallDevicesTable.customerId, customer.id),
        ),
      )
      .limit(1);

    if (!device) {
      res.status(404).json({ error: "Dispositivo não encontrado" });
      return;
    }

    const recentScans = await db
      .select()
      .from(deviceScansTable)
      .where(
        and(
          eq(deviceScansTable.deviceId, deviceId),
          eq(deviceScansTable.deviceType, "firewall"),
        ),
      )
      .orderBy(desc(deviceScansTable.startedAt))
      .limit(10);

    res.json(
      schemas.GetFirewallResponse.parse({ ...device, recentScans }),
    );
  },
);

router.delete(
  "/firewalls/:deviceId",
  requireAuth,
  async (req, res): Promise<void> => {
    const customer = req.customer!;
    const deviceId = req.params.deviceId as string;

    const [deleted] = await db
      .delete(firewallDevicesTable)
      .where(
        and(
          eq(firewallDevicesTable.id, deviceId),
          eq(firewallDevicesTable.customerId, customer.id),
        ),
      )
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Dispositivo não encontrado" });
      return;
    }
    res.sendStatus(204);
  },
);

router.get(
  "/firewalls/:deviceId/scans",
  requireAuth,
  async (req, res): Promise<void> => {
    const customer = req.customer!;
    const deviceId = req.params.deviceId as string;

    const [device] = await db
      .select()
      .from(firewallDevicesTable)
      .where(
        and(
          eq(firewallDevicesTable.id, deviceId),
          eq(firewallDevicesTable.customerId, customer.id),
        ),
      )
      .limit(1);

    if (!device) {
      res.status(404).json({ error: "Dispositivo não encontrado" });
      return;
    }

    const scans = await db
      .select()
      .from(deviceScansTable)
      .where(
        and(
          eq(deviceScansTable.deviceId, deviceId),
          eq(deviceScansTable.deviceType, "firewall"),
        ),
      )
      .orderBy(desc(deviceScansTable.startedAt));

    res.json(schemas.ListFirewallScansResponse.parse(scans));
  },
);

router.post(
  "/firewalls/:deviceId/scans",
  requireAuth,
  async (req, res): Promise<void> => {
    const customer = req.customer!;
    const deviceId = req.params.deviceId as string;

    const [device] = await db
      .select()
      .from(firewallDevicesTable)
      .where(
        and(
          eq(firewallDevicesTable.id, deviceId),
          eq(firewallDevicesTable.customerId, customer.id),
        ),
      )
      .limit(1);

    if (!device) {
      res.status(404).json({ error: "Dispositivo não encontrado" });
      return;
    }

    const [scan] = await db
      .insert(deviceScansTable)
      .values({
        deviceId,
        deviceType: "firewall",
        status: "running",
        startedAt: new Date(),
      })
      .returning();

    runFirewallScan(scan.id)
      .then(() =>
        db
          .update(firewallDevicesTable)
          .set({ lastScanAt: new Date(), updatedAt: new Date() })
          .where(eq(firewallDevicesTable.id, deviceId)),
      )
      .catch((err) => {
        logger.error({ err, scanId: scan.id }, "Firewall scan failed");
        db.update(deviceScansTable)
          .set({ status: "failed", completedAt: new Date() })
          .where(eq(deviceScansTable.id, scan.id))
          .catch(() => {});
      });

    res.status(201).json(schemas.ListFirewallScansResponseItem.parse(scan));
  },
);

router.get(
  "/firewall-scans/:scanId",
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
          eq(deviceScansTable.deviceType, "firewall"),
        ),
      )
      .limit(1);

    if (!scan) {
      res.status(404).json({ error: "Varredura não encontrada" });
      return;
    }

    const [device] = await db
      .select()
      .from(firewallDevicesTable)
      .where(
        and(
          eq(firewallDevicesTable.id, scan.deviceId),
          eq(firewallDevicesTable.customerId, customer.id),
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

    const controls = buildFirewallControls(
      findings
        .filter((f) => f.status !== "resolved" && f.status !== "ignored")
        .map((f) => ({ id: f.id, controlId: f.controlId })),
    );

    res.json(
      schemas.GetFirewallScanResponse.parse({
        ...scan,
        deviceName: device.name,
        deviceType: "firewall" as const,
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
