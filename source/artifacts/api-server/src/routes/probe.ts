import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  db,
  probeRegistrationsTable,
  probeScanJobsTable,
  deviceScansTable,
  deviceFindingsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { signPowerShellScript } from "../lib/psSign";

let _templateCache: string | null = null;
async function getProbeTemplate(): Promise<string> {
  if (_templateCache) return _templateCache;
  const tplPath = path.join(__dirname, "probe_installer_template.ps1");
  _templateCache = await readFile(tplPath, "utf-8");
  return _templateCache;
}

async function generateProbeScript(token: string): Promise<string> {
  const template = await getProbeTemplate();
  const content  = template.replace("%%PROBE_TOKEN%%", token);
  return signPowerShellScript(content);
}

const router: IRouter = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateProbeToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

async function resolveProbeFromToken(req: Request): Promise<typeof probeRegistrationsTable.$inferSelect | null> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  const [probe] = await db
    .select()
    .from(probeRegistrationsTable)
    .where(eq(probeRegistrationsTable.probeToken, token))
    .limit(1);
  return probe ?? null;
}

// Mark probes as offline if not seen in 5 minutes
async function markStaleProbesOffline(): Promise<void> {
  const cutoff = new Date(Date.now() - 5 * 60 * 1000);
  await db
    .update(probeRegistrationsTable)
    .set({ status: "offline", updatedAt: new Date() })
    .where(
      and(
        eq(probeRegistrationsTable.status, "online"),
        lt(probeRegistrationsTable.lastSeenAt, cutoff),
      ),
    );
}

// ─── Public routes (Bearer probe token, no Clerk) ─────────────────────────────

// POST /probe/checkin — probe heartbeat + registration
// Returns pending scan jobs for this probe
router.post("/probe/checkin", async (req: Request, res: Response): Promise<void> => {
  const probe = await resolveProbeFromToken(req);
  if (!probe) {
    res.status(401).json({ error: "Token inválido" });
    return;
  }

  const body = z.object({
    hostname: z.string().optional(),
    ipAddress: z.string().optional(),
    os: z.string().optional(),
    agentVersion: z.string().optional(),
    probeMachineId: z.string().optional(),
  }).safeParse(req.body);

  const updates: Record<string, unknown> = {
    status: "online",
    lastSeenAt: new Date(),
    updatedAt: new Date(),
  };
  if (body.success) {
    if (body.data.hostname) updates.hostname = body.data.hostname;
    if (body.data.ipAddress) updates.ipAddress = body.data.ipAddress;
    if (body.data.os) updates.os = body.data.os;
    if (body.data.agentVersion) updates.agentVersion = body.data.agentVersion;
    if (body.data.probeMachineId && !probe.probeMachineId) {
      updates.probeMachineId = body.data.probeMachineId;
    }
  }

  await db
    .update(probeRegistrationsTable)
    .set(updates)
    .where(eq(probeRegistrationsTable.id, probe.id));

  // Fetch queued jobs for this probe
  const pendingJobs = await db
    .select({
      jobId: probeScanJobsTable.id,
      targetIp: probeScanJobsTable.targetIp,
      targetHostname: probeScanJobsTable.targetHostname,
      deviceType: probeScanJobsTable.deviceType,
      deviceScanId: probeScanJobsTable.deviceScanId,
    })
    .from(probeScanJobsTable)
    .where(
      and(
        eq(probeScanJobsTable.probeId, probe.id),
        eq(probeScanJobsTable.status, "queued"),
      ),
    );

  if (pendingJobs.length > 0) {
    await db
      .update(probeScanJobsTable)
      .set({ status: "running", pickedUpAt: new Date() })
      .where(
        and(
          eq(probeScanJobsTable.probeId, probe.id),
          eq(probeScanJobsTable.status, "queued"),
        ),
      );
  }

  res.json({ probeId: probe.id, pendingJobs });
});

// POST /probe/results/:jobId — probe submits scan findings
router.post("/probe/results/:jobId", async (req: Request, res: Response): Promise<void> => {
  const probe = await resolveProbeFromToken(req);
  if (!probe) {
    res.status(401).json({ error: "Token inválido" });
    return;
  }

  const [job] = await db
    .select()
    .from(probeScanJobsTable)
    .where(
      and(
        eq(probeScanJobsTable.id, req.params.jobId as string),
        eq(probeScanJobsTable.probeId, probe.id),
      ),
    )
    .limit(1);

  if (!job) {
    res.status(404).json({ error: "Job não encontrado" });
    return;
  }

  const parsed = z.object({
    status: z.enum(["completed", "failed"]),
    findings: z.array(z.object({
      controlId: z.string(),
      title: z.string(),
      category: z.string(),
      severity: z.enum(["critical", "high", "medium", "low"]),
      description: z.string(),
      rationale: z.string(),
      remediation: z.string(),
      references: z.array(z.string()).default([]),
      affectedResource: z.string().optional(),
      evidence: z.record(z.unknown()).optional(),
    })).default([]),
    totalChecks: z.number().int().default(0),
    passedChecks: z.number().int().default(0),
  }).safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { findings, totalChecks, passedChecks } = parsed.data;

  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity]++;

  // Insert findings
  if (findings.length > 0) {
    await db.insert(deviceFindingsTable).values(
      findings.map((f) => ({
        deviceScanId: job.deviceScanId,
        controlId: f.controlId,
        title: f.title,
        category: f.category,
        severity: f.severity as "critical" | "high" | "medium" | "low",
        status: "open" as const,
        affectedResource: f.affectedResource ?? null,
        description: f.description,
        rationale: f.rationale,
        remediation: f.remediation,
        references: f.references,
        evidence: f.evidence ?? null,
      })),
    );
  }

  // Update device scan record
  await db
    .update(deviceScansTable)
    .set({
      status: parsed.data.status === "completed" ? "completed" : "failed",
      completedAt: new Date(),
      totalChecks,
      passedChecks,
      failedChecks: findings.length,
      criticalCount: counts.critical,
      highCount: counts.high,
      mediumCount: counts.medium,
      lowCount: counts.low,
    })
    .where(eq(deviceScansTable.id, job.deviceScanId));

  // Update job
  await db
    .update(probeScanJobsTable)
    .set({ status: parsed.data.status, completedAt: new Date() })
    .where(eq(probeScanJobsTable.id, job.id));

  logger.info({ probeId: probe.id, jobId: job.id, findings: findings.length }, "Probe scan results received");
  res.json({ ok: true });
});

// ─── Authenticated management routes (Clerk) ──────────────────────────────────

// GET /probes — list all probes for customer
router.get("/probes", requireAuth, async (req, res): Promise<void> => {
  await markStaleProbesOffline();
  const customer = req.customer!;
  const probes = await db
    .select({
      id: probeRegistrationsTable.id,
      displayName: probeRegistrationsTable.displayName,
      hostname: probeRegistrationsTable.hostname,
      ipAddress: probeRegistrationsTable.ipAddress,
      os: probeRegistrationsTable.os,
      agentVersion: probeRegistrationsTable.agentVersion,
      status: probeRegistrationsTable.status,
      lastSeenAt: probeRegistrationsTable.lastSeenAt,
      createdAt: probeRegistrationsTable.createdAt,
    })
    .from(probeRegistrationsTable)
    .where(eq(probeRegistrationsTable.customerId, customer.id))
    .orderBy(desc(probeRegistrationsTable.createdAt));
  res.json(probes);
});

// POST /probes — create probe registration + return token (shown once)
router.post("/probes", requireAuth, async (req, res): Promise<void> => {
  const parsed = z.object({
    displayName: z.string().min(1),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const customer = req.customer!;
  const probeToken = generateProbeToken();

  const [created] = await db
    .insert(probeRegistrationsTable)
    .values({
      customerId: customer.id,
      displayName: parsed.data.displayName,
      probeToken,
      status: "pending",
    })
    .returning();

  // Return the raw token once — not stored in plaintext after this
  res.status(201).json({ ...created, probeToken });
});

// DELETE /probes/:probeId — remove probe
router.delete("/probes/:probeId", requireAuth, async (req, res): Promise<void> => {
  const customer = req.customer!;
  const [deleted] = await db
    .delete(probeRegistrationsTable)
    .where(
      and(
        eq(probeRegistrationsTable.id, req.params.probeId as string),
        eq(probeRegistrationsTable.customerId, customer.id),
      ),
    )
    .returning({ id: probeRegistrationsTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Probe não encontrado" });
    return;
  }
  res.sendStatus(204);
});

// GET /probes/:probeId/download — generate per-probe installer with embedded token, sign and serve
router.get("/probes/:probeId/download", requireAuth, async (req, res): Promise<void> => {
  const customer = req.customer!;
  const [probe] = await db
    .select({ id: probeRegistrationsTable.id, probeToken: probeRegistrationsTable.probeToken })
    .from(probeRegistrationsTable)
    .where(
      and(
        eq(probeRegistrationsTable.id, req.params.probeId as string),
        eq(probeRegistrationsTable.customerId, customer.id),
      ),
    )
    .limit(1);

  if (!probe) {
    res.status(404).json({ error: "Probe não encontrado" });
    return;
  }

  try {
    const signed = await generateProbeScript(probe.probeToken);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", 'attachment; filename="Instalar_WNRAudit_Probe.ps1"');
    res.send(Buffer.from(signed, "utf-8"));
  } catch (err) {
    logger.error({ err }, "Falha ao gerar/assinar instalador do probe");
    res.status(500).json({ error: "Erro ao gerar instalador assinado" });
  }
});

export default router;
