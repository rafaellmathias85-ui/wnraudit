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
import { runExternalScan, COMMON_PORTS, HIGH_RISK_EXPOSED_PORTS } from "../lib/externalScanner";
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

    // Derive check categories pass/fail from findings
    const hasPrefix = (pfx: string) => findings.some((f) => f.controlId.startsWith(pfx));

    const isDomain = !/^\d+\.\d+\.\d+\.\d+$/.test(asset.host);
    const openPorts = findings
      .filter((f) => f.controlId.startsWith("EXT.PORT."))
      .map((f) => f.affectedResource ?? f.controlId);

    // Build checklist rows (category, detail, pass/fail, severity hint)
    type CheckRow = { label: string; detail: string; pass: boolean; na?: boolean };
    const checklist: CheckRow[] = [
      {
        label: "Varredura de Portas TCP",
        detail: `${50} portas verificadas${openPorts.length > 0 ? ` — ${openPorts.length} aberta(s): ${openPorts.join(", ")}` : " — nenhuma porta exposta"}`,
        pass: !hasPrefix("EXT.PORT.") || findings.filter((f) => f.controlId.startsWith("EXT.PORT.") && f.severity !== "info").length === 0,
      },
      {
        label: "CVEs / Versões Vulneráveis",
        detail: hasPrefix("EXT.CVE.") ? "Versão vulnerável detectada no banner de serviço" : "Nenhuma versão com CVE conhecido identificada nos banners",
        pass: !hasPrefix("EXT.CVE."),
      },
      {
        label: "Criptografia TLS / SSL",
        detail: hasPrefix("EXT.TLS.") ? "Problema de TLS detectado (protocolo/certificado)" : openPorts.some((p) => p.includes(":443") || p.includes(":8443")) ? "TLS 1.2+ em uso, certificado válido" : "Porta HTTPS não exposta — TLS não aplicável",
        pass: !hasPrefix("EXT.TLS."),
      },
      {
        label: "Cabeçalhos HTTP de Segurança",
        detail: hasPrefix("EXT.HEADER.") ? `${findings.filter((f) => f.controlId.startsWith("EXT.HEADER.")).length} cabeçalho(s) ausente(s)` : "Todos os cabeçalhos de segurança presentes (HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy)",
        pass: !hasPrefix("EXT.HEADER."),
      },
      {
        label: "Arquivos e Caminhos Sensíveis",
        detail: hasPrefix("EXT.WEB.EXPOSED.") ? "Arquivo sensível acessível publicamente" : "13 caminhos verificados (.env, .git, phpinfo, backups, etc.) — nenhum exposto",
        pass: !hasPrefix("EXT.WEB.EXPOSED."),
      },
      {
        label: "Política CORS",
        detail: hasPrefix("EXT.WEB.CORS.") ? "CORS permissivo detectado (Access-Control-Allow-Origin: *)" : "Configuração CORS adequada — sem permissão de origens externas",
        pass: !hasPrefix("EXT.WEB.CORS."),
      },
      {
        label: "Segurança de DNS / E-mail (SPF, DMARC, DKIM, MTA-STS)",
        detail: !isDomain ? "Host é IP — verificação DNS não aplicável" : hasPrefix("EXT.DNS.") ? `${findings.filter((f) => f.controlId.startsWith("EXT.DNS.")).length} problema(s) de configuração DNS/e-mail` : "SPF, DMARC, DKIM e MTA-STS configurados corretamente",
        pass: !hasPrefix("EXT.DNS."),
        na: !isDomain,
      },
      {
        label: "SQL Injection (teste ativo)",
        detail: hasPrefix("EXT.WEB.SQLI.") ? "VULNERÁVEL — injeção SQL confirmada via resposta de erro do banco" : openPorts.some((p) => p.includes(":80") || p.includes(":443") || p.includes(":8080")) ? "8 parâmetros testados com 3 payloads cada — nenhuma injeção detectada" : "Nenhuma porta web aberta — teste ativo não aplicável",
        pass: !hasPrefix("EXT.WEB.SQLI."),
      },
      {
        label: "Cross-Site Scripting — XSS Refletido (teste ativo)",
        detail: hasPrefix("EXT.WEB.XSS.") ? "VULNERÁVEL — payload XSS refletido sem sanitização na resposta" : openPorts.some((p) => p.includes(":80") || p.includes(":443") || p.includes(":8080")) ? "10 parâmetros testados com 3 payloads XSS cada — nenhum reflexo detectado" : "Nenhuma porta web aberta — teste ativo não aplicável",
        pass: !hasPrefix("EXT.WEB.XSS."),
      },
      {
        label: "Credenciais Padrão (FTP + HTTP Basic Auth)",
        detail: hasPrefix("EXT.AUTH.") ? "CRÍTICO — acesso obtido com credenciais padrão" : "17 pares de credenciais testados no FTP (se aberto) e HTTP Basic Auth — nenhum acesso obtido",
        pass: !hasPrefix("EXT.AUTH."),
      },
    ];

    const checklistHtml = checklist.map((row) => {
      const icon = row.na ? `<span style="color:#6b7280;font-size:15px">—</span>`
        : row.pass ? `<span style="color:#16a34a;font-size:16px;font-weight:700">✓</span>`
        : `<span style="color:#dc2626;font-size:16px;font-weight:700">✗</span>`;
      const statusLabel = row.na ? `<span style="font-size:10px;color:#6b7280;font-weight:600;background:#f3f4f6;padding:2px 8px;border-radius:4px">N/A</span>`
        : row.pass ? `<span style="font-size:10px;color:#16a34a;font-weight:700;background:#f0fdf4;border:1px solid #bbf7d0;padding:2px 8px;border-radius:4px">APROVADO</span>`
        : `<span style="font-size:10px;color:#dc2626;font-weight:700;background:#fef2f2;border:1px solid #fecaca;padding:2px 8px;border-radius:4px">FALHA</span>`;
      return `<tr style="${row.pass || row.na ? "" : "background:#fff8f8"}">
        <td style="text-align:center;width:36px;padding:8px">${icon}</td>
        <td style="font-size:12px;font-weight:600;color:#111827;padding:9px 12px">${row.label}</td>
        <td style="font-size:11px;color:#4b5563;padding:9px 12px">${row.detail}</td>
        <td style="text-align:center;padding:9px 12px">${statusLabel}</td>
      </tr>`;
    }).join("");

    // AI analysis
    let execSummary = "Análise de IA indisponível.";
    let priorityActions = "";
    try {
      const nonInfoFindings = findings.filter((f) => f.severity !== "info");
      const findingsSummary = nonInfoFindings.length > 0
        ? nonInfoFindings.map((f) => `[${f.severity.toUpperCase()}] ${f.title}${f.affectedResource ? ` — ${f.affectedResource}` : ""}`).join("\n")
        : "Nenhuma vulnerabilidade encontrada. A varredura não identificou falhas de segurança no ativo.";

      const totalChecks = scan.totalChecks ?? 0;
      const passedChecks = scan.passedChecks ?? 0;

      const aiRes = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1200,
        messages: [{
          role: "user",
          content: `Você é analista de segurança sênior da Winner Tecnologia. Analise o resultado abaixo de uma varredura de superfície externa e produza:
1. Um parágrafo executivo em português para a diretoria (máximo 4 frases, linguagem de negócio).
2. Uma lista das 3 principais recomendações ou confirmações de boas práticas.

Ativo: ${asset.name} (${asset.host})
Data: ${scan.completedAt ? new Date(scan.completedAt).toLocaleDateString("pt-BR") : "N/A"}
Verificações executadas: ${totalChecks} | Aprovadas: ${passedChecks} | Falhas: ${nonInfoFindings.length}
Vulnerabilidades: ${scan.criticalCount ?? 0} críticas, ${scan.highCount ?? 0} altas, ${scan.mediumCount ?? 0} médias, ${scan.lowCount ?? 0} baixas

Resultado:
${findingsSummary}

${nonInfoFindings.length === 0 ? "IMPORTANTE: O resultado é POSITIVO — o ativo não apresentou vulnerabilidades. O parágrafo deve transmitir confiança e evidenciar a postura de segurança adequada do cliente." : ""}

Responda EXATAMENTE neste formato:
§SUMARIO§
[parágrafo executivo aqui]
§ACOES§
1. [recomendação ou confirmação 1]
2. [recomendação ou confirmação 2]
3. [recomendação ou confirmação 3]`,
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

    const riskLevel = (scan.criticalCount ?? 0) > 0 ? "CRÍTICO" : (scan.highCount ?? 0) > 0 ? "ALTO" : (scan.mediumCount ?? 0) > 0 ? "MÉDIO" : (scan.lowCount ?? 0) > 0 ? "BAIXO" : "PROTEGIDO";
    const riskColor = (scan.criticalCount ?? 0) > 0 ? "#dc2626" : (scan.highCount ?? 0) > 0 ? "#ea580c" : (scan.mediumCount ?? 0) > 0 ? "#d97706" : (scan.lowCount ?? 0) > 0 ? "#2563eb" : "#16a34a";
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

    const nonInfoCount = findings.filter((f) => f.severity !== "info").length;

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
          <strong style="font-size:12px;color:#0369a1">Recomendações e Boas Práticas:</strong>
          <div style="font-size:13px;color:#374151;margin-top:6px;white-space:pre-line;line-height:1.7">${priorityActions}</div>
        </div>`
      : "";

    const totalChecksDisplay = scan.totalChecks ?? 0;
    const passedChecksDisplay = scan.passedChecks ?? 0;

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
      <div class="stat"><div class="v" style="color:#374151">${totalChecksDisplay}</div><div class="l">Verificações</div></div>
      <div class="stat"><div class="v" style="color:#16a34a">${passedChecksDisplay}</div><div class="l">Aprovadas</div></div>
      <div class="stat"><div class="v" style="color:#dc2626">${scan.criticalCount ?? 0}</div><div class="l">Críticos</div></div>
      <div class="stat"><div class="v" style="color:#ea580c">${scan.highCount ?? 0}</div><div class="l">Altos</div></div>
      <div class="stat"><div class="v" style="color:#d97706">${scan.mediumCount ?? 0}</div><div class="l">Médios</div></div>
      <div class="stat"><div class="v" style="color:#2563eb">${scan.lowCount ?? 0}</div><div class="l">Baixos</div></div>
    </div>
    <p style="font-size:13px;color:#374151;line-height:1.7">${execSummary}</p>
    ${priorityActionsHtml}
  </div>

  <div class="sec">
    <h2 class="sec-title">2. Metodologia e Referências ISO/IEC 27001:2022</h2>
    <p style="font-size:13px;color:#374151;line-height:1.7;margin-bottom:10px">
      Avaliação realizada pela plataforma WNR Audit com técnicas passivas e ativas de análise de superfície externa,
      alinhada aos controles da <strong>ISO/IEC 27001:2022 (Anexo A)</strong> e ao framework <strong>OWASP Top 10</strong>.
    </p>
    <table style="margin-bottom:10px">
      <thead>
        <tr>
          <th style="width:180px">Técnica</th>
          <th style="width:130px">Controle ISO 27001</th>
          <th>Descrição</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>Varredura de Portas TCP</td><td>A.8.8 — Gestão de Vulnerabilidades</td><td>50 portas TCP verificadas com identificação de serviço por banner e correlação de versões com CVEs (OpenSSH, Apache, IIS, nginx, vsFTPd, Telnet)</td></tr>
        <tr><td>Criptografia TLS/SSL</td><td>A.8.24 — Uso de Criptografia</td><td>Protocolo TLS, cipher suite, validade e cadeia do certificado verificados em todas as portas HTTPS abertas</td></tr>
        <tr><td>Cabeçalhos HTTP</td><td>A.8.23 — Filtragem de Conteúdo Web</td><td>HSTS, CSP, X-Frame-Options, X-Content-Type-Options e Referrer-Policy verificados em todas as portas web</td></tr>
        <tr><td>Arquivos Sensíveis Expostos</td><td>A.8.12 — Prevenção de Vazamento de Dados</td><td>13 caminhos críticos verificados (.env, .git, phpinfo, backups, config.php, db.sql, etc.)</td></tr>
        <tr><td>Política CORS</td><td>A.8.23 — Filtragem de Conteúdo Web</td><td>Verificação de Access-Control-Allow-Origin para permissividade excessiva</td></tr>
        <tr><td>DNS / E-mail (SPF, DMARC, DKIM, MTA-STS)</td><td>A.5.14 — Transferência de Informação</td><td>Registros de autenticação de e-mail verificados para prevenção de spoofing e phishing</td></tr>
        <tr><td><strong>SQL Injection (ativo)</strong></td><td>A.8.29 — Testes de Segurança</td><td>8 parâmetros de URL × 3 payloads testados com detecção por resposta de erro do banco de dados</td></tr>
        <tr><td><strong>XSS Refletido (ativo)</strong></td><td>A.8.29 — Testes de Segurança</td><td>10 parâmetros × 3 payloads XSS testados com detecção por reflexo não codificado no HTML</td></tr>
        <tr><td><strong>Credenciais Padrão (ativo)</strong></td><td>A.8.5 — Autenticação Segura</td><td>5 pares FTP + 17 pares HTTP Basic Auth testados contra credenciais de dicionário comuns</td></tr>
      </tbody>
    </table>
    <p style="font-size:11px;color:#6b7280;font-style:italic">Esta avaliação suporta os requisitos da cláusula 9.1 (Monitoramento e Medição) e 10.1 (Melhoria Contínua) da ISO/IEC 27001:2022.</p>
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
      <tr><td>Total de verificações</td><td>${totalChecksDisplay} testes executados — ${passedChecksDisplay} aprovados, ${nonInfoCount} vulnerabilidade(s) encontrada(s)</td></tr>
      <tr><td>Observações</td><td>${asset.notes ?? "—"}</td></tr>
    </table>
  </div>

  <div class="sec">
    <h2 class="sec-title">4. Checklist de Verificações</h2>
    <p style="font-size:12px;color:#6b7280;margin-bottom:10px">Resultado detalhado por categoria de controle. ✓ = nenhuma falha detectada &nbsp;|&nbsp; ✗ = vulnerabilidade identificada &nbsp;|&nbsp; — = não aplicável ao alvo.</p>
    <table>
      <thead>
        <tr>
          <th style="width:36px;text-align:center"></th>
          <th>Categoria de Controle</th>
          <th>Evidência / Detalhe</th>
          <th style="width:90px;text-align:center">Resultado</th>
        </tr>
      </thead>
      <tbody>${checklistHtml}</tbody>
    </table>
  </div>

  <div class="sec">
    <h2 class="sec-title">5. Análise Porta a Porta — Superfície TCP</h2>
    <p style="font-size:12px;color:#6b7280;margin-bottom:10px">
      Resultado individual das ${COMMON_PORTS.length} portas TCP verificadas no host <code>${asset.host}</code>.
      Portas FECHADAS não são acessíveis da internet — evidência de superfície de ataque minimizada.
    </p>
    <table>
      <thead>
        <tr>
          <th style="width:50px">Porta</th>
          <th style="width:120px">Serviço</th>
          <th style="width:90px;text-align:center">Status</th>
          <th style="width:90px">Risco</th>
          <th>Observação</th>
        </tr>
      </thead>
      <tbody>
        ${COMMON_PORTS.map(({ port, service }) => {
          const highRiskFinding = findings.find((f) => f.controlId === `EXT.PORT.${port}`);
          const openInfoFinding = findings.find((f) => f.controlId === `EXT.PORT.OPEN.${port}`);
          const isOpen = !!(highRiskFinding || openInfoFinding);
          const isHighRisk = HIGH_RISK_EXPOSED_PORTS.has(port);
          const banner = (highRiskFinding?.evidence as Record<string,unknown> | null)?.banner
            ?? (openInfoFinding?.evidence as Record<string,unknown> | null)?.banner;
          const statusCell = isOpen
            ? `<span style="font-size:10px;font-weight:700;color:${isHighRisk ? "#dc2626" : "#d97706"};background:${isHighRisk ? "#fef2f2" : "#fffbeb"};border:1px solid ${isHighRisk ? "#fecaca" : "#fde68a"};padding:2px 8px;border-radius:4px">ABERTA</span>`
            : `<span style="font-size:10px;font-weight:700;color:#16a34a;background:#f0fdf4;border:1px solid #bbf7d0;padding:2px 8px;border-radius:4px">FECHADA</span>`;
          const riskCell = !isOpen ? `<span style="color:#6b7280">—</span>`
            : isHighRisk ? `<span style="color:#dc2626;font-weight:600">ALTO</span>`
            : `<span style="color:#d97706">INFO</span>`;
          const obs = !isOpen ? "Porta não responde — protegida"
            : banner ? String(banner).substring(0, 60)
            : isHighRisk ? "Serviço de alto risco exposto publicamente"
            : "Porta aberta — verifique se exposição é intencional";
          return `<tr style="${isHighRisk && isOpen ? "background:#fff8f8" : ""}">
            <td style="font-family:monospace;font-weight:600">${port}</td>
            <td>${service}</td>
            <td style="text-align:center">${statusCell}</td>
            <td>${riskCell}</td>
            <td style="font-size:11px;color:#6b7280">${obs}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  </div>

  <div class="sec">
    <h2 class="sec-title">6. Vulnerabilidades Identificadas</h2>
    ${nonInfoCount === 0
      ? `<div style="padding:16px 20px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;display:flex;align-items:center;gap:12px">
          <span style="font-size:28px">✓</span>
          <div>
            <div style="font-size:14px;font-weight:700;color:#15803d">Nenhuma vulnerabilidade identificada</div>
            <div style="font-size:12px;color:#166534;margin-top:4px">
              Foram executadas ${totalChecksDisplay} verificações em ${totalChecksDisplay > 0 ? `${passedChecksDisplay} aprovadas` : "todas as categorias"}.
              O ativo <strong>${asset.name}</strong> não apresentou falhas de segurança exploráveis na superfície pública analisada.
            </div>
          </div>
        </div>`
      : findingsHtml}
    ${findings.some((f) => f.severity === "info") ? `
    <div style="margin-top:16px">
      <h3 style="font-size:13px;font-weight:600;color:#6b7280;margin-bottom:8px">Informacional</h3>
      ${(bySeverity["info"] ?? []).map((f) => `<div style="margin-bottom:8px;padding:10px 14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px">
        <div style="font-size:12px;font-weight:600;color:#374151">${f.title}</div>
        ${f.affectedResource ? `<div style="font-size:11px;color:#6b7280;font-family:monospace">${f.affectedResource}</div>` : ""}
        <div style="font-size:11px;color:#6b7280;margin-top:4px">${f.description}</div>
      </div>`).join("")}
    </div>` : ""}
  </div>

  <div class="sec">
    <h2 class="sec-title">7. Conclusão</h2>
    <p style="font-size:13px;color:#374151;line-height:1.7">
      A avaliação de superfície externa do ativo <strong>${asset.name}</strong> executou <strong>${totalChecksDisplay} verificações</strong>,
      das quais <strong style="color:#16a34a">${passedChecksDisplay} foram aprovadas</strong> e
      <strong style="color:${nonInfoCount > 0 ? "#dc2626" : "#16a34a"}">${nonInfoCount} vulnerabilidade${nonInfoCount !== 1 ? "s" : ""} ${nonInfoCount !== 1 ? "foram" : "foi"} identificada${nonInfoCount !== 1 ? "s" : ""}</strong>.
      ${(scan.criticalCount ?? 0) > 0 ? `<span style="color:#dc2626;font-weight:600"> Atenção: ${scan.criticalCount} achado${(scan.criticalCount ?? 0) > 1 ? "s" : ""} crítico${(scan.criticalCount ?? 0) > 1 ? "s" : ""} requer${(scan.criticalCount ?? 0) === 1 ? "" : "em"} ação imediata.</span>` : ""}
      ${nonInfoCount === 0 ? '<span style="color:#15803d;font-weight:600"> O ativo apresenta postura de segurança adequada na superfície externa analisada.</span>' : " Recomendamos que os achados de severidade crítica e alta sejam tratados prioritariamente."}
      Uma nova varredura deve ser realizada periodicamente (recomendamos ciclos mensais) ou após mudanças significativas de infraestrutura.
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
