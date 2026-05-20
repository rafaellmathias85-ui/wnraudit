import { Router, type IRouter } from "express";
import PDFDocument from "pdfkit";
import { schemas } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { aggregateEvents } from "./securityCenter";

const router: IRouter = Router();

const SEVERITY_LABEL: Record<string, string> = {
  critical: "CRÍTICA",
  high: "ALTA",
  medium: "MÉDIA",
  low: "BAIXA",
  info: "INFO",
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: "#b91c1c",
  high: "#ea580c",
  medium: "#ca8a04",
  low: "#0369a1",
  info: "#475569",
};

const SOURCE_LABEL: Record<string, string> = {
  m365: "Microsoft 365",
  firewall: "Firewall",
  server: "Servidor",
  external: "Externo",
};

router.get(
  "/reports/security-center",
  requireAuth,
  async (req, res): Promise<void> => {
    const customer = req.customer!;
    const parsed = schemas.GetSecurityCenterReportQueryParams.safeParse(
      req.query,
    );
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const events = await aggregateEvents(customer.id, {
      source: parsed.data.source,
      severity: parsed.data.severity,
      q: parsed.data.q,
      limit: 1000,
    });

    const filename = `security-center-${new Date()
      .toISOString()
      .slice(0, 10)}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );

    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      info: {
        Title: "WNR-Audit — Security Center",
        Author: "WNR Tecnologia",
        Subject: "Relatório consolidado de vulnerabilidades",
      },
    });
    doc.pipe(res);

    // Header
    doc
      .fillColor("#0f172a")
      .fontSize(22)
      .font("Helvetica-Bold")
      .text("WNR-Audit — Security Center", { align: "left" });
    doc
      .moveDown(0.1)
      .fillColor("#475569")
      .fontSize(10)
      .font("Helvetica")
      .text(
        `Cliente: ${customer.organizationName ?? customer.email}    •    Gerado em: ${new Date().toLocaleString("pt-BR")}`,
      );

    if (
      parsed.data.source ||
      parsed.data.severity ||
      (parsed.data.q && parsed.data.q.length > 0)
    ) {
      const filters: string[] = [];
      if (parsed.data.source)
        filters.push(`origem=${SOURCE_LABEL[parsed.data.source] ?? parsed.data.source}`);
      if (parsed.data.severity)
        filters.push(`severidade=${SEVERITY_LABEL[parsed.data.severity]}`);
      if (parsed.data.q) filters.push(`busca="${parsed.data.q}"`);
      doc
        .moveDown(0.1)
        .fillColor("#94a3b8")
        .fontSize(9)
        .text(`Filtros aplicados: ${filters.join(" • ")}`);
    }

    doc.moveDown(0.6);

    // Summary
    const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const e of events) {
      if (e.status === "open") counts[e.severity] += 1;
    }
    const summaryX = doc.x;
    const summaryY = doc.y;
    doc
      .roundedRect(summaryX, summaryY, 500, 60, 6)
      .fillAndStroke("#f1f5f9", "#e2e8f0");
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(11);
    doc.text("Resumo de eventos abertos", summaryX + 12, summaryY + 8);
    const sevX = [12, 110, 208, 306, 404];
    const sevs: Array<keyof typeof counts> = [
      "critical",
      "high",
      "medium",
      "low",
      "info",
    ];
    sevs.forEach((sev, i) => {
      const x = summaryX + sevX[i];
      doc
        .fillColor(SEVERITY_COLOR[sev])
        .fontSize(20)
        .font("Helvetica-Bold")
        .text(String(counts[sev]), x, summaryY + 24, { width: 90 });
      doc
        .fillColor("#475569")
        .fontSize(8)
        .font("Helvetica")
        .text(SEVERITY_LABEL[sev], x, summaryY + 48, { width: 90 });
    });
    doc.x = summaryX;
    doc.y = summaryY + 72;

    doc
      .moveDown(0.3)
      .fillColor("#475569")
      .fontSize(9)
      .text(`Total de eventos no relatório: ${events.length}`);
    doc.moveDown(0.8);

    // Events
    doc
      .fillColor("#0f172a")
      .fontSize(13)
      .font("Helvetica-Bold")
      .text("Eventos");
    doc.moveDown(0.4);

    const writeEvent = (
      e: (typeof events)[number],
      idx: number,
    ) => {
      if (doc.y > doc.page.height - 130) doc.addPage();
      const top = doc.y;
      doc.roundedRect(doc.x, top, 500, 1, 0).fillAndStroke("#e2e8f0", "#e2e8f0");
      doc.moveDown(0.3);

      // Severity pill
      const badgeWidth = 60;
      const badgeY = doc.y;
      doc
        .roundedRect(doc.x, badgeY, badgeWidth, 14, 3)
        .fill(SEVERITY_COLOR[e.severity]);
      doc
        .fillColor("#ffffff")
        .fontSize(8)
        .font("Helvetica-Bold")
        .text(SEVERITY_LABEL[e.severity], doc.x, badgeY + 3, {
          width: badgeWidth,
          align: "center",
        });

      doc
        .fillColor("#0f172a")
        .fontSize(11)
        .font("Helvetica-Bold")
        .text(`${idx + 1}. ${e.title}`, doc.x + 70, badgeY, {
          width: 430,
        });

      doc
        .fillColor("#64748b")
        .fontSize(8)
        .font("Helvetica")
        .text(
          `${SOURCE_LABEL[e.source]} • ${e.targetName} • ${e.controlId} • ${e.category}` +
            (e.affectedResource ? `\n${e.affectedResource}` : ""),
          doc.x + 70,
          undefined,
          { width: 430 },
        );

      doc
        .fillColor("#94a3b8")
        .fontSize(8)
        .text(
          `Detectado em ${e.detectedAt.toLocaleString("pt-BR")}`,
          doc.x + 70,
          undefined,
          { width: 430 },
        );

      doc.moveDown(0.6);
    };

    if (events.length === 0) {
      doc
        .fillColor("#475569")
        .fontSize(10)
        .font("Helvetica")
        .text("Nenhum evento corresponde aos filtros aplicados.");
    } else {
      events.forEach(writeEvent);
    }

    // Footer
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      doc.switchToPage(range.start + i);
      doc
        .fontSize(8)
        .fillColor("#94a3b8")
        .text(
          `WNR-Audit • Página ${i + 1} de ${range.count}`,
          48,
          doc.page.height - 32,
          { align: "center", width: doc.page.width - 96 },
        );
    }

    doc.end();
  },
);

export default router;
