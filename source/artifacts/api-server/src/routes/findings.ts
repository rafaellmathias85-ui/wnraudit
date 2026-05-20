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
  "/scans/:scanId/findings",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = schemas.ListScanFindingsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const query = schemas.ListScanFindingsQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: query.error.message });
      return;
    }
    const customer = req.customer!;

    const [scan] = await db
      .select({ id: scansTable.id })
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

    const conditions = [eq(findingsTable.scanId, scan.id)];
    if (query.data.severity) {
      conditions.push(eq(findingsTable.severity, query.data.severity));
    }
    if (query.data.status) {
      conditions.push(eq(findingsTable.status, query.data.status));
    }

    const findings = await db
      .select()
      .from(findingsTable)
      .where(and(...conditions))
      .orderBy(desc(findingsTable.detectedAt));

    res.json(
      schemas.ListScanFindingsResponse.parse(
        findings.map((f) => ({
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
      ),
    );
  },
);

router.get(
  "/findings/:findingId",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = schemas.GetFindingParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const customer = req.customer!;

    const [row] = await db
      .select({ finding: findingsTable, tenantName: microsoftTenantsTable.displayName })
      .from(findingsTable)
      .innerJoin(scansTable, eq(scansTable.id, findingsTable.scanId))
      .innerJoin(
        microsoftTenantsTable,
        eq(microsoftTenantsTable.id, scansTable.tenantId),
      )
      .where(
        and(
          eq(findingsTable.id, params.data.findingId),
          eq(microsoftTenantsTable.customerId, customer.id),
        ),
      )
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Achado não encontrado" });
      return;
    }

    res.json(
      schemas.GetFindingResponse.parse({
        id: row.finding.id,
        scanId: row.finding.scanId,
        controlId: row.finding.controlId,
        title: row.finding.title,
        category: row.finding.category,
        severity: row.finding.severity,
        status: row.finding.status,
        affectedResource: row.finding.affectedResource,
        detectedAt: row.finding.detectedAt,
        description: row.finding.description,
        rationale: row.finding.rationale,
        remediation: row.finding.remediation,
        configPath: row.finding.configPath ?? null,
        references: row.finding.references ?? [],
        evidence: row.finding.evidence ?? null,
        tenantName: row.tenantName,
      }),
    );
  },
);

router.patch(
  "/findings/:findingId",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = schemas.UpdateFindingStatusParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = schemas.UpdateFindingStatusBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const customer = req.customer!;

    const [existing] = await db
      .select({ id: findingsTable.id })
      .from(findingsTable)
      .innerJoin(scansTable, eq(scansTable.id, findingsTable.scanId))
      .innerJoin(
        microsoftTenantsTable,
        eq(microsoftTenantsTable.id, scansTable.tenantId),
      )
      .where(
        and(
          eq(findingsTable.id, params.data.findingId),
          eq(microsoftTenantsTable.customerId, customer.id),
        ),
      )
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Achado não encontrado" });
      return;
    }

    const [updated] = await db
      .update(findingsTable)
      .set({
        status: body.data.status,
        note: body.data.note ?? null,
        updatedAt: new Date(),
      })
      .where(eq(findingsTable.id, existing.id))
      .returning();

    res.json(
      schemas.UpdateFindingStatusResponse.parse({
        id: updated.id,
        scanId: updated.scanId,
        controlId: updated.controlId,
        title: updated.title,
        category: updated.category,
        severity: updated.severity,
        status: updated.status,
        affectedResource: updated.affectedResource,
        detectedAt: updated.detectedAt,
      }),
    );
  },
);

// Silence unused-var warning for sql import (kept for future aggregations)
void sql;

export default router;
