import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  microsoftTenantsTable,
  phishingCampaignsTable,
  phishingTemplatesTable,
  phishingEmployeesTable,
  phishingCampaignTargetsTable,
  phishingEventsTable,
  awarenessModulesTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { sendPhishingEmail } from "../lib/phishingMailer";
import { logger } from "../lib/logger";
import { decryptSecret } from "../lib/msProvisioner";
import { getOAuthClientSecretForClientId } from "../lib/oauth";

const router: IRouter = Router();

// ─── Built-in Templates (seed) ──────────────────────────────────────────────

const BUILTIN_TEMPLATES = [
  {
    name: "Microsoft 365 — Senha Expirando",
    category: "m365",
    subject: "⚠️ Sua senha do Microsoft 365 expira em 24 horas",
    htmlBody: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
<div style="background:#0078d4;padding:20px;text-align:center">
  <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Microsoft_logo.svg/512px-Microsoft_logo.svg.png" height="30" alt="Microsoft" style="filter:brightness(0) invert(1)"/>
</div>
<div style="padding:30px;background:#fff">
  <h2 style="color:#0078d4">Ação necessária: Sua senha expira em breve</h2>
  <p>Olá,</p>
  <p>Sua senha da conta Microsoft 365 expirará em <strong>24 horas</strong>. Para evitar a interrupção do acesso aos seus serviços, você deve atualizar sua senha imediatamente.</p>
  <div style="text-align:center;margin:30px 0">
    <a href="{{PHISHING_LINK}}" style="background:#0078d4;color:#fff;padding:12px 28px;text-decoration:none;border-radius:4px;font-weight:bold">Atualizar senha agora</a>
  </div>
  <p>Se não atualizar sua senha em 24 horas, sua conta será bloqueada e você perderá acesso ao Outlook, Teams e OneDrive.</p>
  <p>Atenciosamente,<br>Equipe de Segurança Microsoft</p>
</div>
{{TRACKING_PIXEL}}
</div>`,
  },
  {
    name: "OneDrive — Arquivo Compartilhado",
    category: "m365",
    subject: "Seu colega compartilhou um arquivo com você no OneDrive",
    htmlBody: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
<div style="background:#0078d4;padding:20px;text-align:center">
  <span style="color:#fff;font-size:22px;font-weight:bold">OneDrive</span>
</div>
<div style="padding:30px;background:#fff">
  <h2 style="color:#333">Arquivo compartilhado com você</h2>
  <p>Um colega compartilhou um documento importante com você:</p>
  <div style="border:1px solid #ddd;padding:15px;border-radius:8px;margin:20px 0">
    <strong>📄 Relatório_Financeiro_2025.xlsx</strong><br>
    <span style="color:#666;font-size:12px">Compartilhado via Microsoft OneDrive</span>
  </div>
  <div style="text-align:center;margin:20px 0">
    <a href="{{PHISHING_LINK}}" style="background:#0078d4;color:#fff;padding:12px 28px;text-decoration:none;border-radius:4px;font-weight:bold">Abrir no OneDrive</a>
  </div>
  <p style="color:#666;font-size:12px">Este link expirará em 7 dias.</p>
</div>
{{TRACKING_PIXEL}}
</div>`,
  },
  {
    name: "RH — Atualização de Benefícios",
    category: "hr",
    subject: "Ação necessária: Confirme seus benefícios até sexta-feira",
    htmlBody: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
<div style="background:#2e7d32;padding:20px;text-align:center">
  <span style="color:#fff;font-size:20px;font-weight:bold">RH — Recursos Humanos</span>
</div>
<div style="padding:30px;background:#fff">
  <h2 style="color:#2e7d32">Confirmação de Benefícios — Prazo: Sexta-feira</h2>
  <p>Prezado colaborador,</p>
  <p>O período de confirmação de benefícios está aberto. Você precisa acessar o portal e confirmar suas opções até <strong>sexta-feira às 18h</strong>.</p>
  <p>Benefícios disponíveis para confirmação:</p>
  <ul>
    <li>Plano de saúde</li>
    <li>Vale-refeição / Vale-alimentação</li>
    <li>Seguro de vida</li>
  </ul>
  <div style="text-align:center;margin:30px 0">
    <a href="{{PHISHING_LINK}}" style="background:#2e7d32;color:#fff;padding:12px 28px;text-decoration:none;border-radius:4px;font-weight:bold">Acessar Portal de Benefícios</a>
  </div>
</div>
{{TRACKING_PIXEL}}
</div>`,
  },
  {
    name: "Financeiro — Boleto em Aberto",
    category: "financial",
    subject: "⚠️ Boleto em atraso — Regularize sua situação",
    htmlBody: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
<div style="background:#c62828;padding:20px;text-align:center">
  <span style="color:#fff;font-size:20px;font-weight:bold">Central Financeira</span>
</div>
<div style="padding:30px;background:#fff">
  <h2 style="color:#c62828">Boleto em atraso — Ação imediata necessária</h2>
  <p>Identificamos um boleto bancário em aberto vinculado ao CNPJ da sua empresa.</p>
  <div style="background:#fff3e0;border-left:4px solid #ff9800;padding:15px;margin:20px 0">
    <strong>Vencimento:</strong> Ontem<br>
    <strong>Valor:</strong> R$ 2.847,50<br>
    <strong>Situação:</strong> Em atraso — multa incidindo
  </div>
  <div style="text-align:center;margin:20px 0">
    <a href="{{PHISHING_LINK}}" style="background:#c62828;color:#fff;padding:12px 28px;text-decoration:none;border-radius:4px;font-weight:bold">Visualizar e pagar boleto</a>
  </div>
</div>
{{TRACKING_PIXEL}}
</div>`,
  },
  {
    name: "TI — Atualização de Segurança Obrigatória",
    category: "it",
    subject: "[TI] Atualização crítica de segurança — instale até hoje",
    htmlBody: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
<div style="background:#37474f;padding:20px;text-align:center">
  <span style="color:#fff;font-size:20px;font-weight:bold">🔒 Departamento de TI</span>
</div>
<div style="padding:30px;background:#fff">
  <h2 style="color:#37474f">Atualização crítica de segurança</h2>
  <p>O departamento de TI identificou uma vulnerabilidade crítica que afeta seu dispositivo.</p>
  <p>Uma atualização de segurança <strong>obrigatória</strong> está disponível e deve ser instalada <strong>hoje até as 17h</strong> para garantir a conformidade com as políticas de segurança da empresa.</p>
  <div style="background:#e3f2fd;border-left:4px solid #1565c0;padding:15px;margin:20px 0">
    <strong>CVE:</strong> CVE-2025-XXXXX<br>
    <strong>Criticidade:</strong> Alta<br>
    <strong>Sistemas afetados:</strong> Windows 10/11
  </div>
  <div style="text-align:center;margin:20px 0">
    <a href="{{PHISHING_LINK}}" style="background:#1565c0;color:#fff;padding:12px 28px;text-decoration:none;border-radius:4px;font-weight:bold">Instalar atualização agora</a>
  </div>
</div>
{{TRACKING_PIXEL}}
</div>`,
  },
];

// ─── Templates ───────────────────────────────────────────────────────────────

router.get("/phishing/templates", requireAuth, async (req, res): Promise<void> => {
  const customer = req.customer!;
  const custom = await db
    .select()
    .from(phishingTemplatesTable)
    .where(eq(phishingTemplatesTable.customerId, customer.id))
    .orderBy(desc(phishingTemplatesTable.createdAt));

  // Merge built-in templates (with synthetic IDs)
  const builtins = BUILTIN_TEMPLATES.map((t, i) => ({
    id: `builtin-${i}`,
    customerId: null,
    isBuiltIn: true,
    createdAt: new Date("2025-01-01").toISOString(),
    updatedAt: new Date("2025-01-01").toISOString(),
    ...t,
  }));

  res.json([...builtins, ...custom]);
});

router.post("/phishing/templates", requireAuth, async (req, res): Promise<void> => {
  const parsed = z
    .object({
      name: z.string().min(1),
      subject: z.string().min(1),
      htmlBody: z.string().min(1),
      category: z.string().optional().default("other"),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const customer = req.customer!;
  const [created] = await db
    .insert(phishingTemplatesTable)
    .values({ ...parsed.data, customerId: customer.id, isBuiltIn: false })
    .returning();
  res.status(201).json(created);
});

router.delete("/phishing/templates/:templateId", requireAuth, async (req, res): Promise<void> => {
  const customer = req.customer!;
  const [deleted] = await db
    .delete(phishingTemplatesTable)
    .where(
      and(
        eq(phishingTemplatesTable.id, req.params.templateId as string),
        eq(phishingTemplatesTable.customerId, customer.id),
      ),
    )
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Template não encontrado" });
    return;
  }
  res.sendStatus(204);
});

// ─── Employees ────────────────────────────────────────────────────────────────

router.get("/phishing/employees", requireAuth, async (req, res): Promise<void> => {
  const customer = req.customer!;
  const rows = await db
    .select({
      id: phishingEmployeesTable.id,
      customerId: phishingEmployeesTable.customerId,
      tenantId: phishingEmployeesTable.tenantId,
      tenantDisplayName: microsoftTenantsTable.displayName,
      name: phishingEmployeesTable.name,
      email: phishingEmployeesTable.email,
      department: phishingEmployeesTable.department,
      createdAt: phishingEmployeesTable.createdAt,
      updatedAt: phishingEmployeesTable.updatedAt,
    })
    .from(phishingEmployeesTable)
    .leftJoin(microsoftTenantsTable, eq(phishingEmployeesTable.tenantId, microsoftTenantsTable.id))
    .where(eq(phishingEmployeesTable.customerId, customer.id))
    .orderBy(phishingEmployeesTable.name);
  res.json(rows);
});

router.post("/phishing/employees", requireAuth, async (req, res): Promise<void> => {
  const parsed = z
    .object({
      name: z.string().min(1),
      email: z.string().email(),
      department: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const customer = req.customer!;
  const [created] = await db
    .insert(phishingEmployeesTable)
    .values({ ...parsed.data, customerId: customer.id })
    .returning();
  res.status(201).json(created);
});

router.post("/phishing/employees/bulk", requireAuth, async (req, res): Promise<void> => {
  const parsed = z
    .object({
      employees: z.array(
        z.object({
          name: z.string().min(1),
          email: z.string().email(),
          department: z.string().optional(),
        }),
      ).min(1),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const customer = req.customer!;
  const rows = await db
    .insert(phishingEmployeesTable)
    .values(parsed.data.employees.map((e) => ({ ...e, customerId: customer.id })))
    .returning();
  res.status(201).json(rows);
});

// POST /phishing/employees/sync-from-tenant/:tenantId
// Importa usuários ativos do Microsoft 365 como funcionários de phishing.
// Insere apenas e-mails ainda não cadastrados (idempotente).
router.post(
  "/phishing/employees/sync-from-tenant/:tenantId",
  requireAuth,
  async (req, res): Promise<void> => {
    const customer = req.customer!;
    const { tenantId } = req.params as { tenantId: string };

    const [tenant] = await db
      .select()
      .from(microsoftTenantsTable)
      .where(
        and(
          eq(microsoftTenantsTable.id, tenantId),
          eq(microsoftTenantsTable.customerId, customer.id),
          eq(microsoftTenantsTable.status, "connected"),
        ),
      )
      .limit(1);

    if (!tenant) {
      res.status(404).json({ error: "Tenant não encontrado ou não está conectado." });
      return;
    }

    // Obter access token usando credenciais armazenadas do tenant
    const clientSecret = tenant.encryptedClientSecret
      ? decryptSecret(tenant.encryptedClientSecret)
      : getOAuthClientSecretForClientId(tenant.provisionedAppId);

    if (!tenant.provisionedAppId || !clientSecret) {
      res.status(503).json({ error: "Credenciais OAuth do tenant não configuradas." });
      return;
    }

    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(tenant.microsoftTenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: tenant.provisionedAppId,
          client_secret: clientSecret,
          grant_type: "client_credentials",
          scope: "https://graph.microsoft.com/.default",
        }),
      },
    );
    const tokenData = (await tokenRes.json()) as Record<string, unknown>;
    if (!tokenRes.ok) {
      res.status(502).json({ error: "Falha ao autenticar no Microsoft Graph." });
      return;
    }
    const accessToken = tokenData.access_token as string;

    // Buscar todos os usuários ativos com paginação
    type GraphUser = { displayName?: string; mail?: string; userPrincipalName?: string; department?: string; accountEnabled?: boolean };
    const graphUsers: GraphUser[] = [];
    let nextLink: string | null =
      "https://graph.microsoft.com/v1.0/users?$select=displayName,mail,userPrincipalName,department,accountEnabled&$top=999&$filter=accountEnabled eq true";

    while (nextLink) {
      const graphRes = await fetch(nextLink, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!graphRes.ok) {
        res.status(502).json({ error: "Falha ao buscar usuários no Microsoft Graph." });
        return;
      }
      const page = (await graphRes.json()) as { value?: GraphUser[]; "@odata.nextLink"?: string };
      graphUsers.push(...(page.value ?? []));
      nextLink = page["@odata.nextLink"] ?? null;
    }

    // Normalizar: usar mail; fallback para userPrincipalName se não tiver @#EXT# (conta externa)
    const candidates = graphUsers
      .map((u) => {
        const email = u.mail?.trim().toLowerCase() ||
          (u.userPrincipalName && !u.userPrincipalName.includes("#EXT#")
            ? u.userPrincipalName.trim().toLowerCase()
            : null);
        return email && u.displayName
          ? { name: u.displayName.trim(), email, department: u.department?.trim() || null }
          : null;
      })
      .filter((u): u is { name: string; email: string; department: string | null } => u !== null);

    if (candidates.length === 0) {
      res.json({ inserted: 0, skipped: 0, total: 0 });
      return;
    }

    // Verificar e-mails já cadastrados para este customer (idempotente)
    const existing = await db
      .select({ email: phishingEmployeesTable.email })
      .from(phishingEmployeesTable)
      .where(eq(phishingEmployeesTable.customerId, customer.id));
    const existingEmails = new Set(existing.map((r) => r.email.toLowerCase()));

    const toInsert = candidates.filter((c) => !existingEmails.has(c.email));

    if (toInsert.length > 0) {
      await db.insert(phishingEmployeesTable).values(
        toInsert.map((e) => ({ ...e, customerId: customer.id, tenantId })),
      );
    }

    res.json({
      inserted: toInsert.length,
      skipped: candidates.length - toInsert.length,
      total: candidates.length,
    });
  },
);

router.patch("/phishing/employees/:employeeId", requireAuth, async (req, res): Promise<void> => {
  const parsed = z
    .object({
      name: z.string().min(1).optional(),
      email: z.string().email().optional(),
      department: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const customer = req.customer!;
  const [updated] = await db
    .update(phishingEmployeesTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(
      and(
        eq(phishingEmployeesTable.id, req.params.employeeId as string),
        eq(phishingEmployeesTable.customerId, customer.id),
      ),
    )
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Funcionário não encontrado" });
    return;
  }
  res.json(updated);
});

router.delete("/phishing/employees/:employeeId", requireAuth, async (req, res): Promise<void> => {
  const customer = req.customer!;
  const [deleted] = await db
    .delete(phishingEmployeesTable)
    .where(
      and(
        eq(phishingEmployeesTable.id, req.params.employeeId as string),
        eq(phishingEmployeesTable.customerId, customer.id),
      ),
    )
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Funcionário não encontrado" });
    return;
  }
  res.sendStatus(204);
});

// ─── Campaigns ────────────────────────────────────────────────────────────────

router.get("/phishing/campaigns", requireAuth, async (req, res): Promise<void> => {
  const customer = req.customer!;
  const campaigns = await db
    .select({
      id: phishingCampaignsTable.id,
      customerId: phishingCampaignsTable.customerId,
      tenantId: phishingCampaignsTable.tenantId,
      tenantDisplayName: microsoftTenantsTable.displayName,
      name: phishingCampaignsTable.name,
      description: phishingCampaignsTable.description,
      status: phishingCampaignsTable.status,
      senderName: phishingCampaignsTable.senderName,
      senderEmail: phishingCampaignsTable.senderEmail,
      authorizationNote: phishingCampaignsTable.authorizationNote,
      startedAt: phishingCampaignsTable.startedAt,
      completedAt: phishingCampaignsTable.completedAt,
      createdAt: phishingCampaignsTable.createdAt,
      updatedAt: phishingCampaignsTable.updatedAt,
    })
    .from(phishingCampaignsTable)
    .leftJoin(microsoftTenantsTable, eq(phishingCampaignsTable.tenantId, microsoftTenantsTable.id))
    .where(eq(phishingCampaignsTable.customerId, customer.id))
    .orderBy(desc(phishingCampaignsTable.createdAt));

  // Add target counts
  const enriched = await Promise.all(
    campaigns.map(async (c) => {
      const [{ count: targetCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(phishingCampaignTargetsTable)
        .where(eq(phishingCampaignTargetsTable.campaignId, c.id));
      const [{ count: clickCount }] = await db
        .select({ count: sql<number>`count(distinct target_id)::int` })
        .from(phishingEventsTable)
        .innerJoin(
          phishingCampaignTargetsTable,
          eq(phishingEventsTable.targetId, phishingCampaignTargetsTable.id),
        )
        .where(
          and(
            eq(phishingCampaignTargetsTable.campaignId, c.id),
            eq(phishingEventsTable.eventType, "clicked"),
          ),
        );
      return { ...c, targetCount, clickCount };
    }),
  );

  res.json(enriched);
});

router.post("/phishing/campaigns", requireAuth, async (req, res): Promise<void> => {
  const parsed = z
    .object({
      name: z.string().min(1),
      description: z.string().optional(),
      senderName: z.string().min(1).default("Suporte TI"),
      senderEmail: z.string().email(),
      authorizationNote: z.string().min(10, "Nota de autorização deve ter ao menos 10 caracteres"),
      tenantId: z.string().uuid().optional().nullable(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const customer = req.customer!;
  if (parsed.data.tenantId) {
    const [tenant] = await db
      .select({ id: microsoftTenantsTable.id })
      .from(microsoftTenantsTable)
      .where(
        and(
          eq(microsoftTenantsTable.id, parsed.data.tenantId),
          eq(microsoftTenantsTable.customerId, customer.id),
        ),
      )
      .limit(1);
    if (!tenant) {
      res.status(400).json({ error: "Tenant não encontrado" });
      return;
    }
  }
  const [created] = await db
    .insert(phishingCampaignsTable)
    .values({ ...parsed.data, customerId: customer.id, status: "draft" })
    .returning();
  res.status(201).json(created);
});

router.get("/phishing/campaigns/:campaignId", requireAuth, async (req, res): Promise<void> => {
  const customer = req.customer!;
  const campaignId = req.params.campaignId as string;
  const [campaign] = await db
    .select({
      id: phishingCampaignsTable.id,
      customerId: phishingCampaignsTable.customerId,
      tenantId: phishingCampaignsTable.tenantId,
      tenantDisplayName: microsoftTenantsTable.displayName,
      name: phishingCampaignsTable.name,
      description: phishingCampaignsTable.description,
      status: phishingCampaignsTable.status,
      senderName: phishingCampaignsTable.senderName,
      senderEmail: phishingCampaignsTable.senderEmail,
      authorizationNote: phishingCampaignsTable.authorizationNote,
      startedAt: phishingCampaignsTable.startedAt,
      completedAt: phishingCampaignsTable.completedAt,
      createdAt: phishingCampaignsTable.createdAt,
      updatedAt: phishingCampaignsTable.updatedAt,
    })
    .from(phishingCampaignsTable)
    .leftJoin(microsoftTenantsTable, eq(phishingCampaignsTable.tenantId, microsoftTenantsTable.id))
    .where(
      and(
        eq(phishingCampaignsTable.id, campaignId),
        eq(phishingCampaignsTable.customerId, customer.id),
      ),
    )
    .limit(1);
  if (!campaign) {
    res.status(404).json({ error: "Campanha não encontrada" });
    return;
  }

  const targets = await db
    .select({
      id: phishingCampaignTargetsTable.id,
      trackingToken: phishingCampaignTargetsTable.trackingToken,
      sentAt: phishingCampaignTargetsTable.sentAt,
      employeeId: phishingCampaignTargetsTable.employeeId,
      employeeName: phishingEmployeesTable.name,
      employeeEmail: phishingEmployeesTable.email,
      employeeDepartment: phishingEmployeesTable.department,
    })
    .from(phishingCampaignTargetsTable)
    .innerJoin(
      phishingEmployeesTable,
      eq(phishingCampaignTargetsTable.employeeId, phishingEmployeesTable.id),
    )
    .where(eq(phishingCampaignTargetsTable.campaignId, campaignId));

  const targetIds = targets.map((t) => t.id);
  const events =
    targetIds.length > 0
      ? await db
          .select()
          .from(phishingEventsTable)
          .where(inArray(phishingEventsTable.targetId, targetIds))
          .orderBy(desc(phishingEventsTable.occurredAt))
      : [];

  const eventsByTarget = events.reduce(
    (acc, e) => {
      if (!acc[e.targetId]) acc[e.targetId] = [];
      acc[e.targetId].push(e);
      return acc;
    },
    {} as Record<string, typeof events>,
  );

  const targetsWithEvents = targets.map((t) => ({
    ...t,
    events: eventsByTarget[t.id] ?? [],
  }));

  res.json({ ...campaign, targets: targetsWithEvents });
});

router.patch("/phishing/campaigns/:campaignId", requireAuth, async (req, res): Promise<void> => {
  const parsed = z
    .object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      senderName: z.string().optional(),
      senderEmail: z.string().email().optional(),
      authorizationNote: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const customer = req.customer!;
  const [updated] = await db
    .update(phishingCampaignsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(
      and(
        eq(phishingCampaignsTable.id, req.params.campaignId as string),
        eq(phishingCampaignsTable.customerId, customer.id),
      ),
    )
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Campanha não encontrada" });
    return;
  }
  res.json(updated);
});

router.delete("/phishing/campaigns/:campaignId", requireAuth, async (req, res): Promise<void> => {
  const customer = req.customer!;
  const [deleted] = await db
    .delete(phishingCampaignsTable)
    .where(
      and(
        eq(phishingCampaignsTable.id, req.params.campaignId as string),
        eq(phishingCampaignsTable.customerId, customer.id),
      ),
    )
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Campanha não encontrada" });
    return;
  }
  res.sendStatus(204);
});

// Add targets to campaign
router.post(
  "/phishing/campaigns/:campaignId/targets",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = z
      .object({
        employeeIds: z.array(z.string().uuid()).min(1),
        templateId: z.string().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const customer = req.customer!;
    const [campaign] = await db
      .select()
      .from(phishingCampaignsTable)
      .where(
        and(
          eq(phishingCampaignsTable.id, req.params.campaignId as string),
          eq(phishingCampaignsTable.customerId, customer.id),
        ),
      )
      .limit(1);
    if (!campaign) {
      res.status(404).json({ error: "Campanha não encontrada" });
      return;
    }

    const rows = await db
      .insert(phishingCampaignTargetsTable)
      .values(
        parsed.data.employeeIds.map((employeeId) => ({
          campaignId: campaign.id,
          employeeId,
          templateId: parsed.data.templateId ?? null,
        })),
      )
      .returning();
    res.status(201).json(rows);
  },
);

// Dispatch campaign (send emails)
router.post(
  "/phishing/campaigns/:campaignId/dispatch",
  requireAuth,
  async (req, res): Promise<void> => {
    const customer = req.customer!;

    const bodyParsed = z
      .object({ templateId: z.string().optional() })
      .safeParse(req.body);
    const campaignTemplateId = bodyParsed.data?.templateId;

    const [campaign] = await db
      .select()
      .from(phishingCampaignsTable)
      .where(
        and(
          eq(phishingCampaignsTable.id, req.params.campaignId as string),
          eq(phishingCampaignsTable.customerId, customer.id),
        ),
      )
      .limit(1);
    if (!campaign) {
      res.status(404).json({ error: "Campanha não encontrada" });
      return;
    }
    if (campaign.status === "active") {
      res.status(409).json({ error: "Campanha já está ativa" });
      return;
    }

    // Pre-resolve campaign-level template (fallback for targets without their own)
    let fallbackTemplate: { subject: string; htmlBody: string } | null = null;
    if (campaignTemplateId) {
      if (campaignTemplateId.startsWith("builtin-")) {
        const idx = parseInt(campaignTemplateId.replace("builtin-", ""), 10);
        fallbackTemplate = BUILTIN_TEMPLATES[idx] ?? null;
      } else {
        const [tmpl] = await db
          .select({ subject: phishingTemplatesTable.subject, htmlBody: phishingTemplatesTable.htmlBody })
          .from(phishingTemplatesTable)
          .where(
            and(
              eq(phishingTemplatesTable.id, campaignTemplateId),
              eq(phishingTemplatesTable.customerId, customer.id),
            ),
          )
          .limit(1);
        fallbackTemplate = tmpl ?? null;
      }
    }

    const targets = await db
      .select({
        id: phishingCampaignTargetsTable.id,
        trackingToken: phishingCampaignTargetsTable.trackingToken,
        templateId: phishingCampaignTargetsTable.templateId,
        sentAt: phishingCampaignTargetsTable.sentAt,
        employeeName: phishingEmployeesTable.name,
        employeeEmail: phishingEmployeesTable.email,
        templateSubject: phishingTemplatesTable.subject,
        templateHtml: phishingTemplatesTable.htmlBody,
      })
      .from(phishingCampaignTargetsTable)
      .innerJoin(
        phishingEmployeesTable,
        eq(phishingCampaignTargetsTable.employeeId, phishingEmployeesTable.id),
      )
      .leftJoin(
        phishingTemplatesTable,
        eq(phishingCampaignTargetsTable.templateId, phishingTemplatesTable.id),
      )
      .where(eq(phishingCampaignTargetsTable.campaignId, campaign.id));

    if (targets.length === 0) {
      res.status(400).json({ error: "A campanha não tem alvos cadastrados" });
      return;
    }

    const trackingBaseUrl =
      process.env.FRONTEND_BASE_URL?.replace(/\/wnraudit\/?$/, "") ||
      "https://wnrtecnologia.com.br";

    await db
      .update(phishingCampaignsTable)
      .set({ status: "active", startedAt: new Date(), updatedAt: new Date() })
      .where(eq(phishingCampaignsTable.id, campaign.id));

    // Fire and forget — send emails in background
    (async () => {
      for (const target of targets) {
        if (target.sentAt) continue; // already sent
        try {
          // Per-target template takes precedence; fall back to campaign-level; then generic
          const subject =
            target.templateSubject ??
            fallbackTemplate?.subject ??
            `[Teste de Segurança] Ação necessária`;
          const htmlBody =
            target.templateHtml ??
            fallbackTemplate?.htmlBody ??
            `<p>Clique aqui: <a href="{{PHISHING_LINK}}">Link</a></p>{{TRACKING_PIXEL}}`;

          await sendPhishingEmail({
            to: target.employeeEmail,
            toName: target.employeeName,
            fromName: campaign.senderName,
            fromEmail: campaign.senderEmail,
            subject,
            htmlBody,
            trackingToken: target.trackingToken,
            trackingBaseUrl,
          });
          await db
            .update(phishingCampaignTargetsTable)
            .set({ sentAt: new Date() })
            .where(eq(phishingCampaignTargetsTable.id, target.id));
          await db.insert(phishingEventsTable).values({
            targetId: target.id,
            eventType: "sent",
          });
        } catch (err) {
          logger.error({ err, targetId: target.id }, "Failed to send phishing email");
          await db.insert(phishingEventsTable).values({ targetId: target.id, eventType: "failed" }).catch(() => {});
        }
      }
    })().catch((err) => logger.error({ err }, "Dispatch loop failed"));

    res.json({ status: "dispatching", targetCount: targets.length });
  },
);

// Complete campaign
router.post(
  "/phishing/campaigns/:campaignId/complete",
  requireAuth,
  async (req, res): Promise<void> => {
    const customer = req.customer!;
    const [updated] = await db
      .update(phishingCampaignsTable)
      .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(phishingCampaignsTable.id, req.params.campaignId as string),
          eq(phishingCampaignsTable.customerId, customer.id),
        ),
      )
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Campanha não encontrada" });
      return;
    }
    res.json(updated);
  },
);

// ─── Tracking (public — no auth) ─────────────────────────────────────────────

async function recordEvent(
  token: string,
  eventType: "opened" | "clicked" | "submitted" | "reported",
  metadata?: Record<string, unknown>,
) {
  const [target] = await db
    .select()
    .from(phishingCampaignTargetsTable)
    .where(eq(phishingCampaignTargetsTable.trackingToken, token))
    .limit(1);
  if (!target) return null;

  // Bot/scanner detection: security scanners (Microsoft Safe Links, etc.) fire within
  // seconds of delivery. Real humans take at minimum a few minutes to open and act.
  // Ignore open/click events that arrive within 60 s of sentAt.
  if (target.sentAt && (eventType === "opened" || eventType === "clicked")) {
    const msSinceSent = Date.now() - new Date(target.sentAt).getTime();
    if (msSinceSent < 60_000) {
      logger.info({ token, eventType, msSinceSent }, "Event ignored: automated scanner (within 60s of delivery)");
      return target;
    }
  }

  // Only record if not already recorded (idempotent per type)
  const [existing] = await db
    .select({ id: phishingEventsTable.id })
    .from(phishingEventsTable)
    .where(
      and(
        eq(phishingEventsTable.targetId, target.id),
        eq(phishingEventsTable.eventType, eventType),
      ),
    )
    .limit(1);

  if (!existing) {
    await db.insert(phishingEventsTable).values({
      targetId: target.id,
      eventType,
      metadata: metadata ?? null,
    });
  }
  return target;
}

// Tracking pixel — opened
router.get("/phishing/track/:token/open", async (req, res): Promise<void> => {
  const token = req.params.token as string;
  await recordEvent(token, "opened", { ip: req.ip, ua: req.headers["user-agent"] }).catch(
    () => {},
  );
  // Return 1x1 transparent GIF
  const gif = Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    "base64",
  );
  res.set({ "Content-Type": "image/gif", "Cache-Control": "no-store" });
  res.send(gif);
});

// Tracking click — redirect to training
router.get("/phishing/track/:token/click", async (req, res): Promise<void> => {
  const token = req.params.token as string;
  await recordEvent(token, "clicked", { ip: req.ip, ua: req.headers["user-agent"] }).catch(
    () => {},
  );
  const basePath =
    process.env.BASE_PATH ?? "/wnraudit/";
  res.redirect(302, `${basePath}phishing/training/${token}`);
});

// Report as phishing (employee action)
router.post("/phishing/track/:token/report", async (req, res): Promise<void> => {
  const token = req.params.token as string;
  await recordEvent(token, "reported", { ip: req.ip }).catch(() => {});
  res.json({ message: "Obrigado por reportar. Isso é exatamente o que esperamos de você!" });
});

// Submit credentials (record event only — never store credentials)
router.post("/phishing/track/:token/submit", async (req, res): Promise<void> => {
  const token = req.params.token as string;
  await recordEvent(token, "submitted", {
    ip: req.ip,
    fieldsReceived: Object.keys(req.body ?? {}),
  }).catch(() => {});

  // Find the first built-in awareness module to redirect to
  const [module] = await db
    .select({ id: awarenessModulesTable.id })
    .from(awarenessModulesTable)
    .where(eq(awarenessModulesTable.isBuiltIn, true))
    .limit(1);

  const basePath = process.env.BASE_PATH ?? "/wnraudit/";
  if (module) {
    res.redirect(302, `${basePath}phishing/training/${token}?module=${module.id}`);
  } else {
    res.redirect(302, `${basePath}phishing/training/${token}`);
  }
});

// Get target info by token (for training page)
router.get("/phishing/training/:token", async (req, res): Promise<void> => {
  const token = req.params.token as string;
  const [target] = await db
    .select({
      campaignId: phishingCampaignTargetsTable.campaignId,
      employeeName: phishingEmployeesTable.name,
    })
    .from(phishingCampaignTargetsTable)
    .innerJoin(
      phishingEmployeesTable,
      eq(phishingCampaignTargetsTable.employeeId, phishingEmployeesTable.id),
    )
    .where(eq(phishingCampaignTargetsTable.trackingToken, token))
    .limit(1);

  if (!target) {
    res.status(404).json({ error: "Token inválido" });
    return;
  }

  const modules = await db
    .select()
    .from(awarenessModulesTable)
    .where(eq(awarenessModulesTable.isBuiltIn, true))
    .orderBy(awarenessModulesTable.createdAt);

  res.json({ employeeName: target.employeeName, modules });
});

export default router;
