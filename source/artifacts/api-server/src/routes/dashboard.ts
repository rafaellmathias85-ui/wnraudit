import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  microsoftTenantsTable,
  scansTable,
  findingsTable,
} from "@workspace/db";
import { schemas } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get(
  "/dashboard/summary",
  requireAuth,
  async (req, res): Promise<void> => {
    const customer = req.customer!;

    const [tenantStatsRows, scanStatsRows, findingStatsRows, latestScans] =
      await Promise.all([
        db
          .select({
            total: sql<number>`COUNT(*)::int`,
            connected: sql<number>`COUNT(*) FILTER (WHERE ${microsoftTenantsTable.status} = 'connected')::int`,
            lastScanAt: sql<
              Date | null
            >`MAX(${microsoftTenantsTable.lastScanAt})`,
          })
          .from(microsoftTenantsTable)
          .where(eq(microsoftTenantsTable.customerId, customer.id)),

        db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(scansTable)
          .innerJoin(
            microsoftTenantsTable,
            eq(microsoftTenantsTable.id, scansTable.tenantId),
          )
          .where(eq(microsoftTenantsTable.customerId, customer.id)),

        db
          .select({
            open: sql<number>`COUNT(*) FILTER (WHERE ${findingsTable.status} = 'open')::int`,
            critical: sql<number>`COUNT(*) FILTER (WHERE ${findingsTable.status} = 'open' AND ${findingsTable.severity} = 'critical')::int`,
            high: sql<number>`COUNT(*) FILTER (WHERE ${findingsTable.status} = 'open' AND ${findingsTable.severity} = 'high')::int`,
            resolved: sql<number>`COUNT(*) FILTER (WHERE ${findingsTable.status} = 'resolved')::int`,
          })
          .from(findingsTable)
          .innerJoin(scansTable, eq(scansTable.id, findingsTable.scanId))
          .innerJoin(
            microsoftTenantsTable,
            eq(microsoftTenantsTable.id, scansTable.tenantId),
          )
          .where(eq(microsoftTenantsTable.customerId, customer.id)),

        // Average compliance score across most recent scan of each tenant.
        db.execute(sql`
      SELECT s.* FROM ${scansTable} s
      INNER JOIN ${microsoftTenantsTable} t ON t.id = s.tenant_id
      WHERE t.customer_id = ${customer.id}
        AND s.status = 'completed'
        AND s.id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY started_at DESC) as rn
            FROM ${scansTable}
            WHERE status = 'completed'
          ) ranked WHERE rn = 1
        )
    `),
      ]);

    const tenantStats = tenantStatsRows[0];
    const scanStats = scanStatsRows[0];
    const findingStats = findingStatsRows[0];

    const rows = latestScans.rows as Array<{
      total_checks: number;
      passed_checks: number;
    }>;
    let averageScore = 0;
    if (rows.length > 0) {
      const sum = rows.reduce((acc, r) => {
        const total = Number(r.total_checks ?? 0);
        const passed = Number(r.passed_checks ?? 0);
        if (total === 0) return acc;
        return acc + (passed / total) * 100;
      }, 0);
      averageScore = Math.round((sum / rows.length) * 10) / 10;
    }

    res.json(
      schemas.GetDashboardSummaryResponse.parse({
        tenantsCount: tenantStats?.total ?? 0,
        connectedTenantsCount: tenantStats?.connected ?? 0,
        scansCount: scanStats?.count ?? 0,
        openFindingsCount: findingStats?.open ?? 0,
        criticalOpenCount: findingStats?.critical ?? 0,
        highOpenCount: findingStats?.high ?? 0,
        resolvedFindingsCount: findingStats?.resolved ?? 0,
        averageScore,
        lastScanAt: tenantStats?.lastScanAt ?? null,
      }),
    );
  },
);

router.get(
  "/dashboard/recent-findings",
  requireAuth,
  async (req, res): Promise<void> => {
    const customer = req.customer!;
    const recent = await db
      .select({
        id: findingsTable.id,
        controlId: findingsTable.controlId,
        title: findingsTable.title,
        severity: findingsTable.severity,
        tenantId: microsoftTenantsTable.id,
        tenantName: microsoftTenantsTable.displayName,
        detectedAt: findingsTable.detectedAt,
      })
      .from(findingsTable)
      .innerJoin(scansTable, eq(scansTable.id, findingsTable.scanId))
      .innerJoin(
        microsoftTenantsTable,
        eq(microsoftTenantsTable.id, scansTable.tenantId),
      )
      .where(
        and(
          eq(microsoftTenantsTable.customerId, customer.id),
          eq(findingsTable.status, "open"),
        ),
      )
      .orderBy(desc(findingsTable.detectedAt))
      .limit(10);

    res.json(schemas.GetRecentFindingsResponse.parse(recent));
  },
);

router.get(
  "/dashboard/severity-breakdown",
  requireAuth,
  async (req, res): Promise<void> => {
    const customer = req.customer!;
    const rows = await db
      .select({
        severity: findingsTable.severity,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(findingsTable)
      .innerJoin(scansTable, eq(scansTable.id, findingsTable.scanId))
      .innerJoin(
        microsoftTenantsTable,
        eq(microsoftTenantsTable.id, scansTable.tenantId),
      )
      .where(
        and(
          eq(microsoftTenantsTable.customerId, customer.id),
          eq(findingsTable.status, "open"),
        ),
      )
      .groupBy(findingsTable.severity);

    res.json(schemas.GetSeverityBreakdownResponse.parse(rows));
  },
);

router.get(
  "/dashboard/category-breakdown",
  requireAuth,
  async (req, res): Promise<void> => {
    const customer = req.customer!;
    const rows = await db
      .select({
        category: findingsTable.category,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(findingsTable)
      .innerJoin(scansTable, eq(scansTable.id, findingsTable.scanId))
      .innerJoin(
        microsoftTenantsTable,
        eq(microsoftTenantsTable.id, scansTable.tenantId),
      )
      .where(
        and(
          eq(microsoftTenantsTable.customerId, customer.id),
          eq(findingsTable.status, "open"),
        ),
      )
      .groupBy(findingsTable.category)
      .orderBy(desc(sql`COUNT(*)`));

    res.json(schemas.GetCategoryBreakdownResponse.parse(rows));
  },
);

export default router;
