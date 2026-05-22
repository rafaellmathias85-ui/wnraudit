import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  findingsTable,
  scansTable,
  microsoftTenantsTable,
  deviceFindingsTable,
  deviceScansTable,
  externalAssetsTable,
  firewallDevicesTable,
  serverDevicesTable,
} from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
});

const RemediationChatBody = z.object({
  messages: z.array(MessageSchema).min(1).max(30),
});

const SYSTEM_PROMPT = `Você é um especialista em segurança da informação e hardening de sistemas, atendendo MSPs e equipes de TI brasileiras. Sua missão é ajudar a corrigir uma vulnerabilidade de segurança específica detectada por uma varredura automatizada.

Regras obrigatórias:
1. Responda SEMPRE em Português do Brasil, com terminologia técnica formal.
2. Seja objetivo e prático: cada resposta deve conter passos acionáveis.
3. Use formatação Markdown: ## títulos, listas numeradas, \`código em backtick\`, blocos de código para comandos.
4. Para comandos de terminal, especifique o sistema operacional (Windows/Linux).
5. Quando houver múltiplas abordagens (ex: GUI vs PowerShell vs GPO), apresente todas com suas vantagens.
6. Se perguntarem como verificar se a correção foi aplicada, forneça comandos de validação.
7. Nunca minimize a severidade da vulnerabilidade — seja honesto sobre o risco.
8. Se a pergunta fugir do escopo da vulnerabilidade em questão, redirecione gentilmente.`;

function buildFindingContext(finding: {
  title: string;
  category: string;
  severity: string;
  description: string;
  rationale: string;
  remediation: string;
  affectedResource?: string | null;
  controlId: string;
  references?: unknown;
  evidence?: unknown;
}, resourceInfo: string): string {
  return `VULNERABILIDADE DETECTADA:
- Controle: ${finding.controlId}
- Título: ${finding.title}
- Categoria: ${finding.category}
- Severidade: ${finding.severity.toUpperCase()}
- Recurso afetado: ${finding.affectedResource ?? "N/A"}
- Contexto: ${resourceInfo}

DESCRIÇÃO:
${finding.description}

FUNDAMENTO (RATIONALE):
${finding.rationale}

PASSOS DE REMEDIAÇÃO SUGERIDOS (base):
${finding.remediation}

Evidências coletadas: ${JSON.stringify(finding.evidence ?? {})}
Referências: ${JSON.stringify(finding.references ?? [])}`;
}

// Chat for M365 findings
router.post(
  "/findings/:findingId/remediation-chat",
  requireAuth,
  async (req, res): Promise<void> => {
    const customer = req.customer!;
    const findingId = req.params.findingId as string;

    const parsed = RemediationChatBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [finding] = await db
      .select()
      .from(findingsTable)
      .where(eq(findingsTable.id, findingId))
      .limit(1);

    if (!finding) {
      res.status(404).json({ error: "Vulnerabilidade não encontrada" });
      return;
    }

    // Verify customer owns this finding
    const [scan] = await db
      .select({ tenantId: scansTable.tenantId })
      .from(scansTable)
      .where(eq(scansTable.id, finding.scanId))
      .limit(1);

    if (scan) {
      const [tenant] = await db
        .select({ id: microsoftTenantsTable.id })
        .from(microsoftTenantsTable)
        .where(
          and(
            eq(microsoftTenantsTable.id, scan.tenantId),
            eq(microsoftTenantsTable.customerId, customer.id),
          ),
        )
        .limit(1);
      if (!tenant) {
        res.status(403).json({ error: "Acesso negado" });
        return;
      }
    }

    const resourceInfo = `Microsoft 365 / Entra ID — tenant scan`;
    const context = buildFindingContext(finding, resourceInfo);

    const systemWithContext = `${SYSTEM_PROMPT}\n\n---\n${context}`;

    try {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: systemWithContext,
        messages: parsed.data.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });

      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join("");

      res.json({ message: text });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: `Falha na IA: ${msg}` });
    }
  },
);

// Chat for device findings (firewalls, servers, external assets)
router.post(
  "/device-findings/:findingId/remediation-chat",
  requireAuth,
  async (req, res): Promise<void> => {
    const customer = req.customer!;
    const findingId = req.params.findingId as string;

    const parsed = RemediationChatBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [finding] = await db
      .select()
      .from(deviceFindingsTable)
      .where(eq(deviceFindingsTable.id, findingId))
      .limit(1);

    if (!finding) {
      res.status(404).json({ error: "Vulnerabilidade não encontrada" });
      return;
    }

    // Determine device type and verify ownership
    const [scan] = await db
      .select()
      .from(deviceScansTable)
      .where(eq(deviceScansTable.id, finding.deviceScanId))
      .limit(1);

    let resourceInfo = "Dispositivo de rede";
    if (scan) {
      if (scan.deviceType === "firewall") {
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
          res.status(403).json({ error: "Acesso negado" });
          return;
        }
        resourceInfo = `Firewall ${device.manufacturer} ${device.model ?? ""} — ${device.name}`;
      } else if (scan.deviceType === "server") {
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
          res.status(403).json({ error: "Acesso negado" });
          return;
        }
        resourceInfo = `Servidor ${device.os} — ${device.name} (${device.hostname ?? device.ipAddress ?? ""})`;
      } else if (scan.deviceType === "external") {
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
          res.status(403).json({ error: "Acesso negado" });
          return;
        }
        resourceInfo = `Ativo externo ${asset.kind} — ${asset.name} (${asset.host})`;
      }
    }

    const context = buildFindingContext(finding, resourceInfo);
    const systemWithContext = `${SYSTEM_PROMPT}\n\n---\n${context}`;

    try {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: systemWithContext,
        messages: parsed.data.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });

      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join("");

      res.json({ message: text });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: `Falha na IA: ${msg}` });
    }
  },
);

export default router;
