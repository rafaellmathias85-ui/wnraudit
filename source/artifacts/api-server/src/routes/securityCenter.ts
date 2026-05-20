import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import {
  db,
  microsoftTenantsTable,
  scansTable,
  findingsTable,
  deviceScansTable,
  deviceFindingsTable,
  firewallDevicesTable,
  serverDevicesTable,
  externalAssetsTable,
} from "@workspace/db";
import { schemas } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

type Source = "m365" | "firewall" | "server" | "external";
type Severity = "critical" | "high" | "medium" | "low" | "info";

export type AggregatedEvent = {
  id: string;
  source: Source;
  scanId: string;
  controlId: string;
  title: string;
  category: string;
  severity: Severity;
  status: "open" | "ignored" | "resolved";
  targetName: string;
  affectedResource: string | null;
  detectedAt: Date;
  detailUrl: string;
};

export type EventFilters = {
  source?: Source;
  severity?: Severity;
  q?: string;
  limit?: number;
};

export async function aggregateEvents(
  customerId: string,
  filters: EventFilters,
): Promise<AggregatedEvent[]> {
  const events: AggregatedEvent[] = [];
  const want = (s: Source) => !filters.source || filters.source === s;
  const wantSev = (sev: Severity) =>
    !filters.severity || filters.severity === sev;

  // M365 findings
  if (want("m365")) {
    const m365 = await db
      .select({
        id: findingsTable.id,
        scanId: findingsTable.scanId,
        controlId: findingsTable.controlId,
        title: findingsTable.title,
        category: findingsTable.category,
        severity: findingsTable.severity,
        status: findingsTable.status,
        affectedResource: findingsTable.affectedResource,
        detectedAt: findingsTable.detectedAt,
        targetName: microsoftTenantsTable.displayName,
      })
      .from(findingsTable)
      .innerJoin(scansTable, eq(scansTable.id, findingsTable.scanId))
      .innerJoin(
        microsoftTenantsTable,
        eq(microsoftTenantsTable.id, scansTable.tenantId),
      )
      .where(eq(microsoftTenantsTable.customerId, customerId))
      .orderBy(desc(findingsTable.detectedAt));
    for (const r of m365) {
      if (!wantSev(r.severity as Severity)) continue;
      events.push({
        id: r.id,
        source: "m365",
        scanId: r.scanId,
        controlId: r.controlId,
        title: r.title,
        category: r.category,
        severity: r.severity as Severity,
        status: r.status,
        targetName: r.targetName,
        affectedResource: r.affectedResource ?? null,
        detectedAt: r.detectedAt,
        detailUrl: `/findings/${r.id}`,
      });
    }
  }

  // Device findings (firewall, server, external)
  const wantedDeviceTypes: Source[] = (
    ["firewall", "server", "external"] as Source[]
  ).filter(want);

  for (const dt of wantedDeviceTypes) {
    let nameQuery;
    if (dt === "firewall") {
      nameQuery = db
        .select({
          id: deviceFindingsTable.id,
          scanId: deviceFindingsTable.deviceScanId,
          controlId: deviceFindingsTable.controlId,
          title: deviceFindingsTable.title,
          category: deviceFindingsTable.category,
          severity: deviceFindingsTable.severity,
          status: deviceFindingsTable.status,
          affectedResource: deviceFindingsTable.affectedResource,
          detectedAt: deviceFindingsTable.detectedAt,
          deviceId: deviceScansTable.deviceId,
          targetName: firewallDevicesTable.name,
        })
        .from(deviceFindingsTable)
        .innerJoin(
          deviceScansTable,
          eq(deviceScansTable.id, deviceFindingsTable.deviceScanId),
        )
        .innerJoin(
          firewallDevicesTable,
          eq(firewallDevicesTable.id, deviceScansTable.deviceId),
        )
        .where(
          and(
            eq(firewallDevicesTable.customerId, customerId),
            eq(deviceScansTable.deviceType, "firewall"),
          ),
        );
    } else if (dt === "server") {
      nameQuery = db
        .select({
          id: deviceFindingsTable.id,
          scanId: deviceFindingsTable.deviceScanId,
          controlId: deviceFindingsTable.controlId,
          title: deviceFindingsTable.title,
          category: deviceFindingsTable.category,
          severity: deviceFindingsTable.severity,
          status: deviceFindingsTable.status,
          affectedResource: deviceFindingsTable.affectedResource,
          detectedAt: deviceFindingsTable.detectedAt,
          deviceId: deviceScansTable.deviceId,
          targetName: serverDevicesTable.name,
        })
        .from(deviceFindingsTable)
        .innerJoin(
          deviceScansTable,
          eq(deviceScansTable.id, deviceFindingsTable.deviceScanId),
        )
        .innerJoin(
          serverDevicesTable,
          eq(serverDevicesTable.id, deviceScansTable.deviceId),
        )
        .where(
          and(
            eq(serverDevicesTable.customerId, customerId),
            eq(deviceScansTable.deviceType, "server"),
          ),
        );
    } else {
      nameQuery = db
        .select({
          id: deviceFindingsTable.id,
          scanId: deviceFindingsTable.deviceScanId,
          controlId: deviceFindingsTable.controlId,
          title: deviceFindingsTable.title,
          category: deviceFindingsTable.category,
          severity: deviceFindingsTable.severity,
          status: deviceFindingsTable.status,
          affectedResource: deviceFindingsTable.affectedResource,
          detectedAt: deviceFindingsTable.detectedAt,
          deviceId: deviceScansTable.deviceId,
          targetName: externalAssetsTable.name,
        })
        .from(deviceFindingsTable)
        .innerJoin(
          deviceScansTable,
          eq(deviceScansTable.id, deviceFindingsTable.deviceScanId),
        )
        .innerJoin(
          externalAssetsTable,
          eq(externalAssetsTable.id, deviceScansTable.deviceId),
        )
        .where(
          and(
            eq(externalAssetsTable.customerId, customerId),
            eq(deviceScansTable.deviceType, "external"),
          ),
        );
    }

    const rows = await nameQuery.orderBy(desc(deviceFindingsTable.detectedAt));
    const detailPath =
      dt === "firewall"
        ? "firewall-scans"
        : dt === "server"
          ? "server-scans"
          : "external-scans";
    for (const r of rows) {
      if (!wantSev(r.severity as Severity)) continue;
      events.push({
        id: r.id,
        source: dt,
        scanId: r.scanId,
        controlId: r.controlId,
        title: r.title,
        category: r.category,
        severity: r.severity as Severity,
        status: r.status,
        targetName: r.targetName,
        affectedResource: r.affectedResource ?? null,
        detectedAt: r.detectedAt,
        detailUrl: `/${detailPath}/${r.scanId}`,
      });
    }
  }

  // Free-text filter (in-memory; volume per customer is small)
  let filtered = events;
  if (filters.q && filters.q.trim().length > 0) {
    const needle = filters.q.toLowerCase();
    filtered = filtered.filter(
      (e) =>
        e.title.toLowerCase().includes(needle) ||
        e.controlId.toLowerCase().includes(needle) ||
        e.category.toLowerCase().includes(needle) ||
        (e.affectedResource ?? "").toLowerCase().includes(needle) ||
        e.targetName.toLowerCase().includes(needle),
    );
  }

  filtered.sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());
  const limit = filters.limit ?? 200;
  return filtered.slice(0, limit);
}

router.get(
  "/security-center/summary",
  requireAuth,
  async (req, res): Promise<void> => {
    const customer = req.customer!;
    const events = await aggregateEvents(customer.id, { limit: 1000 });
    const open = events.filter((e) => e.status === "open");

    const counts = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    } as Record<Severity, number>;
    const bySourceCounts: Record<Source, number> = {
      m365: 0,
      firewall: 0,
      server: 0,
      external: 0,
    };
    const byCategory = new Map<string, number>();

    for (const e of open) {
      counts[e.severity] += 1;
      bySourceCounts[e.source] += 1;
      byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + 1);
    }

    const topCategories = Array.from(byCategory.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const recentEvents = events.slice(0, 10);

    res.json(
      schemas.GetSecurityCenterSummaryResponse.parse({
        totalEvents: open.length,
        criticalCount: counts.critical,
        highCount: counts.high,
        mediumCount: counts.medium,
        lowCount: counts.low,
        infoCount: counts.info,
        bySource: (Object.entries(bySourceCounts) as [Source, number][]).map(
          ([source, count]) => ({ source, count }),
        ),
        topCategories,
        recentEvents,
      }),
    );
  },
);

router.get(
  "/security-center/events",
  requireAuth,
  async (req, res): Promise<void> => {
    const customer = req.customer!;
    const parsed = schemas.ListSecurityCenterEventsQueryParams.safeParse(
      req.query,
    );
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const events = await aggregateEvents(customer.id, parsed.data);
    res.json(schemas.ListSecurityCenterEventsResponse.parse(events));
  },
);

// Helpers re-exported so the report route can reuse aggregation without duplicating.
export { router as securityCenterRouter };
// Suppress lint warnings about unused imports kept for future use
void or;
void ilike;

export default router;
