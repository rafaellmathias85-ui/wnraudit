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
import { anthropic } from "@workspace/integrations-anthropic-ai";

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

router.get(
  "/external-scans/:scanId/report",
  requireAuth,
  async (req, res): Promise<void> => {
    const customer = req.customer!;
    const scanId = req.params.scanId as string;

    const [scan] = await db
      .select()
      .from(deviceScansTable)
      .where(and(eq(deviceScansTable.id, scanId), eq(deviceScansTable.deviceType, "external")))
      .limit(1);
    if (!scan) { res.status(404).json({ error: "Varredura não encontrada" }); return; }

    const [asset] = await db
      .select()
      .from(externalAssetsTable)
      .where(and(eq(externalAssetsTable.id, scan.deviceId), eq(externalAssetsTable.customerId, customer.id)))
      .limit(1);
    if (!asset) { res.status(404).json({ error: "Varredura não encontrada" }); return; }

    const findings = await db
      .select()
      .from(deviceFindingsTable)
      .where(eq(deviceFindingsTable.deviceScanId, scanId))
      .orderBy(desc(deviceFindingsTable.detectedAt));

    // AI analysis
    let execSummary = "Análise de IA indisponível.";
    let priorityActions = "";
    try {
      const findingsSummary = findings
        .filter((f) => f.severity !== "info")
        .map((f) => `[${f.severity.toUpperCase()}] ${f.title}${f.affectedResource ? ` — ${f.affectedResource}` : ""}`)
        .join("\n") || "Nenhum achado relevante.";

      const aiRes = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1200,
        messages: [{
          role: "user",
          content: `Você é analista de segurança sênior da Winner Tecnologia. Analise os achados de segurança abaixo de uma varredura de superfície externa e produza:
1. Um parágrafo executivo em português para a diretoria (máximo 4 frases, linguagem de negócio).
2. Uma lista das 3 ações prioritárias mais importantes.

Ativo: ${asset.name} (${asset.host})
Data: ${scan.completedAt ? new Date(scan.completedAt).toLocaleDateString("pt-BR") : "N/A"}
Total: ${findings.length} achados (${scan.criticalCount ?? 0} críticos, ${scan.highCount ?? 0} altos, ${scan.mediumCount ?? 0} médios, ${scan.lowCount ?? 0} baixos)

Achados:
${findingsSummary}

Responda EXATAMENTE neste formato:
§SUMARIO§
[parágrafo executivo aqui]
§ACOES§
1. [ação 1]
2. [ação 2]
3. [ação 3]`,
        }],
      });
      const text = aiRes.content[0]?.type === "text" ? aiRes.content[0].text : "";
      const sumMatch = text.match(/§SUMARIO§\s*([\s\S]*?)(?:§ACOES§|$)/);
      const acMatch = text.match(/§ACOES§\s*([\s\S]*?)$/);
      if (sumMatch?.[1]) execSummary = sumMatch[1].trim();
      if (acMatch?.[1]) priorityActions = acMatch[1].trim();
    } catch (err) {
      logger.warn({ err }, "AI analysis for external scan report failed");
    }

    const bySeverity: Record<string, typeof findings> = {
      critical: [], high: [], medium: [], low: [], info: [],
    };
    for (const f of findings) { (bySeverity[f.severity] ??= []).push(f); }

    const riskLevel = (scan.criticalCount ?? 0) > 0 ? "CRÍTICO" : (scan.highCount ?? 0) > 0 ? "ALTO" : (scan.mediumCount ?? 0) > 0 ? "MÉDIO" : "BAIXO";
    const riskColor = (scan.criticalCount ?? 0) > 0 ? "#dc2626" : (scan.highCount ?? 0) > 0 ? "#ea580c" : (scan.mediumCount ?? 0) > 0 ? "#d97706" : "#16a34a";
    const scanDate = scan.completedAt
      ? new Date(scan.completedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })
      : "Em andamento";

    const SEV: Record<string, { label: string; color: string; bg: string }> = {
      critical: { label: "CRÍTICO", color: "#dc2626", bg: "#fef2f2" },
      high: { label: "ALTO", color: "#ea580c", bg: "#fff7ed" },
      medium: { label: "MÉDIO", color: "#d97706", bg: "#fffbeb" },
      low: { label: "BAIXO", color: "#2563eb", bg: "#eff6ff" },
      info: { label: "INFO", color: "#6b7280", bg: "#f9fafb" },
    };

    const findingsHtml = (["critical", "high", "medium", "low"] as const)
      .flatMap((sev) => {
        const items = bySeverity[sev] ?? [];
        if (items.length === 0) return [];
        const cfg = SEV[sev]!;
        return [`<div style="margin-bottom:24px">
          <h3 style="color:${cfg.color};font-size:13px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;margin:0 0 12px 0;padding:8px 12px;background:${cfg.bg};border-left:4px solid ${cfg.color};border-radius:4px">
            ● ${cfg.label} — ${items.length} achado${items.length > 1 ? "s" : ""}
          </h3>
          ${items.map((f) => `<div style="margin-bottom:10px;padding:12px 14px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;page-break-inside:avoid">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:6px">
              <div style="font-size:13px;font-weight:600;color:#111827;flex:1">${f.title}</div>
              <span style="font-size:10px;font-weight:700;color:${cfg.color};background:${cfg.bg};padding:2px 8px;border-radius:999px;white-space:nowrap">${cfg.label}</span>
            </div>
            ${f.affectedResource ? `<div style="font-size:11px;color:#6b7280;margin-bottom:6px;font-family:monospace">${f.affectedResource}</div>` : ""}
            <div style="font-size:12px;color:#374151;margin-bottom:6px">${f.description}</div>
            ${f.remediation ? `<div style="font-size:12px;color:#065f46;background:#ecfdf5;padding:8px 10px;border-radius:4px;white-space:pre-line"><strong>Remediação:</strong> ${f.remediation}</div>` : ""}
          </div>`).join("")}
        </div>`];
      }).join("");

    const priorityActionsHtml = priorityActions
      ? `<div style="margin-top:16px;padding:14px 16px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px">
          <strong style="font-size:12px;color:#0369a1">Ações Prioritárias Recomendadas:</strong>
          <div style="font-size:13px;color:#374151;margin-top:6px;white-space:pre-line;line-height:1.7">${priorityActions}</div>
        </div>`
      : "";

    const nonInfoCount = findings.filter((f) => f.severity !== "info").length;

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Laudo de Segurança — ${asset.name}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#111827;background:#fff}
  @media print{.no-print{display:none!important}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  .hdr{background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);color:#fff;padding:36px 48px 28px}
  .logo{font-size:20px;font-weight:800;letter-spacing:-0.02em}
  .logo-sub{font-size:10px;color:#94a3b8;letter-spacing:0.1em;text-transform:uppercase;margin-top:2px}
  .report-title{font-size:26px;font-weight:800;margin:20px 0 6px}
  .report-sub{font-size:14px;color:#94a3b8;margin-bottom:20px}
  .meta{display:flex;gap:28px;flex-wrap:wrap}
  .meta-item label{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;display:block;margin-bottom:3px}
  .meta-item span{font-size:13px;color:#e2e8f0;font-weight:500}
  .body{padding:32px 48px;max-width:960px;margin:0 auto}
  .sec{margin-bottom:32px}
  .sec-title{font-size:16px;font-weight:700;color:#0f172a;border-bottom:2px solid #e5e7eb;padding-bottom:7px;margin-bottom:14px}
  .stats{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px}
  .stat{flex:1;min-width:90px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:12px;text-align:center}
  .stat .v{font-size:26px;font-weight:800;line-height:1}
  .stat .l{font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-top:4px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{background:#f1f5f9;font-weight:600;color:#374151;text-align:left;padding:8px 12px;border:1px solid #e5e7eb}
  td{padding:7px 12px;border:1px solid #e5e7eb;color:#374151;vertical-align:top}
  .ftr{margin-top:40px;padding:20px 48px;background:#f8fafc;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:flex-end;font-size:11px;color:#6b7280}
  .ftr-r{text-align:right}
  .ftr-r .co{font-size:14px;font-weight:700;color:#0f172a}
  .print-btn{position:fixed;bottom:20px;right:20px;background:#1e3a5f;color:#fff;border:none;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.3)}
</style>
</head>
<body>

<div class="hdr">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px">
    <div>
      <div class="logo">Winner Tecnologia</div>
      <div class="logo-sub">Soluções em Segurança da Informação</div>
    </div>
    <div style="text-align:right">
      <div style="background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:5px 12px;font-size:11px;font-weight:600;color:#e2e8f0;letter-spacing:.06em;text-transform:uppercase">Laudo Técnico</div>
      <div style="font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:.1em;text-transform:uppercase;margin-top:6px">⚠ Confidencial</div>
    </div>
  </div>
  <div class="report-title">Laudo de Segurança — Superfície Externa</div>
  <div class="report-sub">Avaliação de vulnerabilidades e exposição pública de ativos</div>
  <div class="meta">
    <div class="meta-item"><label>Ativo Analisado</label><span>${asset.name} (${asset.host})</span></div>
    <div class="meta-item"><label>Tipo</label><span>${asset.kind ?? "—"}</span></div>
    <div class="meta-item"><label>Data da Varredura</label><span>${scanDate}</span></div>
    <div class="meta-item"><label>Nível de Risco</label><span style="color:${riskColor};font-weight:700">${riskLevel}</span></div>
  </div>
</div>

<div class="body">

  <div class="sec">
    <h2 class="sec-title">1. Sumário Executivo</h2>
    <div style="margin-bottom:14px">
      <span style="display:inline-block;padding:5px 16px;border-radius:999px;font-size:12px;font-weight:800;color:#fff;background:${riskColor}">Risco ${riskLevel}</span>
    </div>
    <div class="stats">
      <div class="stat"><div class="v" style="color:#6b7280">${findings.length}</div><div class="l">Total</div></div>
      <div class="stat"><div class="v" style="color:#dc2626">${scan.criticalCount ?? 0}</div><div class="l">Críticos</div></div>
      <div class="stat"><div class="v" style="color:#ea580c">${scan.highCount ?? 0}</div><div class="l">Altos</div></div>
      <div class="stat"><div class="v" style="color:#d97706">${scan.mediumCount ?? 0}</div><div class="l">Médios</div></div>
      <div class="stat"><div class="v" style="color:#2563eb">${scan.lowCount ?? 0}</div><div class="l">Baixos</div></div>
    </div>
    <p style="font-size:13px;color:#374151;line-height:1.7">${execSummary}</p>
    ${priorityActionsHtml}
  </div>

  <div class="sec">
    <h2 class="sec-title">2. Metodologia</h2>
    <p style="font-size:13px;color:#374151;line-height:1.7;margin-bottom:10px">A varredura foi realizada pela plataforma WNR Audit com técnicas de análise passiva e ativa de superfície externa. Controles avaliados:</p>
    <ul style="margin-left:20px;font-size:12px;color:#374151;line-height:1.9">
      <li>Reconhecimento de portas TCP (48 portas comuns) com identificação de serviço por banner</li>
      <li>Correlação de versões com CVEs conhecidos (OpenSSH, Apache, IIS, nginx, vsFTPd, Telnet)</li>
      <li>Análise de configuração TLS/SSL (protocolo, cipher suite, certificado, validade)</li>
      <li>Verificação de cabeçalhos HTTP de segurança (HSTS, CSP, X-Frame-Options, X-Content-Type-Options)</li>
      <li>Detecção de arquivos e caminhos sensíveis expostos (.env, .git, phpinfo, backups)</li>
      <li>Análise de política CORS (Access-Control-Allow-Origin)</li>
      <li>Auditoria de registros DNS de segurança (SPF, DMARC, DKIM, MTA-STS)</li>
      <li><strong>Teste ativo de SQL Injection</strong> em parâmetros de URL comuns</li>
      <li><strong>Teste ativo de Cross-Site Scripting (XSS) refletido</strong> em parâmetros de entrada</li>
      <li><strong>Teste de credenciais padrão</strong> em FTP (porta 21) e HTTP Basic Auth</li>
    </ul>
  </div>

  <div class="sec">
    <h2 class="sec-title">3. Escopo</h2>
    <table>
      <tr><th>Campo</th><th>Valor</th></tr>
      <tr><td>Ativo</td><td>${asset.name}</td></tr>
      <tr><td>Host / IP</td><td><code>${asset.host}</code>${asset.port ? `:${asset.port}` : ""}</td></tr>
      <tr><td>Tipo de Ativo</td><td>${asset.kind ?? "—"}</td></tr>
      <tr><td>Início da Varredura</td><td>${scan.startedAt ? new Date(scan.startedAt).toLocaleString("pt-BR") : "—"}</td></tr>
      <tr><td>Conclusão</td><td>${scan.completedAt ? new Date(scan.completedAt).toLocaleString("pt-BR") : "Em andamento"}</td></tr>
      <tr><td>Observações</td><td>${asset.notes ?? "—"}</td></tr>
    </table>
  </div>

  <div class="sec">
    <h2 class="sec-title">4. Vulnerabilidades Identificadas</h2>
    ${findings.length === 0
      ? '<p style="color:#16a34a;font-weight:600">✓ Nenhuma vulnerabilidade identificada nesta varredura.</p>'
      : findingsHtml}
  </div>

  <div class="sec">
    <h2 class="sec-title">5. Conclusão</h2>
    <p style="font-size:13px;color:#374151;line-height:1.7">
      A avaliação de superfície externa identificou <strong>${nonInfoCount} vulnerabilidade${nonInfoCount !== 1 ? "s" : ""}</strong> no ativo <strong>${asset.name}</strong>.
      ${(scan.criticalCount ?? 0) > 0 ? `<span style="color:#dc2626;font-weight:600"> Atenção: ${scan.criticalCount} achado${(scan.criticalCount ?? 0) > 1 ? "s" : ""} crítico${(scan.criticalCount ?? 0) > 1 ? "s" : ""} requer${(scan.criticalCount ?? 0) === 1 ? "" : "em"} ação imediata.</span>` : ""}
      Recomendamos que os achados de severidade crítica e alta sejam tratados prioritariamente. Uma nova varredura deve ser realizada após as correções para validar a efetividade das remediações.
    </p>
  </div>

</div>

<div class="ftr">
  <div>
    Emitido em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}<br>
    WNR Audit — Winner Tecnologia &nbsp;|&nbsp; ID: <code>${scanId}</code>
  </div>
  <div class="ftr-r">
    <div class="co">Winner Tecnologia</div>
    <div>wnrtecnologia.com.br</div>
  </div>
</div>

<button class="print-btn no-print" onclick="window.print()">🖨 Imprimir / Salvar PDF</button>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  },
);

export default router;
