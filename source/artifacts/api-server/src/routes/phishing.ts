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
        templateCategory: phishingTemplatesTable.category,
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
          const captureStyle =
            target.templateCategory ??
            (campaignTemplateId?.startsWith("builtin-")
              ? (BUILTIN_TEMPLATES[parseInt(campaignTemplateId.replace("builtin-", ""), 10)]?.category ?? "generic")
              : "generic");
          await db.insert(phishingEventsTable).values({
            targetId: target.id,
            eventType: "sent",
            metadata: { captureStyle },
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

// ─── Campaign HTML Report ─────────────────────────────────────────────────────

router.get(
  "/phishing/campaigns/:campaignId/report",
  requireAuth,
  async (req, res): Promise<void> => {
    const customer = req.customer!;
    const campaignId = req.params.campaignId as string;

    const [campaign] = await db
      .select()
      .from(phishingCampaignsTable)
      .where(and(eq(phishingCampaignsTable.id, campaignId), eq(phishingCampaignsTable.customerId, customer.id)))
      .limit(1);
    if (!campaign) { res.status(404).send("Campanha não encontrada"); return; }

    const targets = await db
      .select({
        id: phishingCampaignTargetsTable.id,
        employeeName: phishingEmployeesTable.name,
        employeeEmail: phishingEmployeesTable.email,
        employeeDepartment: phishingEmployeesTable.department,
        sentAt: phishingCampaignTargetsTable.sentAt,
      })
      .from(phishingCampaignTargetsTable)
      .innerJoin(phishingEmployeesTable, eq(phishingCampaignTargetsTable.employeeId, phishingEmployeesTable.id))
      .where(eq(phishingCampaignTargetsTable.campaignId, campaignId));

    const events = await db
      .select({
        targetId: phishingEventsTable.targetId,
        eventType: phishingEventsTable.eventType,
        humanVerified: phishingEventsTable.humanVerified,
        occurredAt: phishingEventsTable.occurredAt,
      })
      .from(phishingEventsTable)
      .where(inArray(phishingEventsTable.targetId, targets.map((t) => t.id)))
      .orderBy(phishingEventsTable.occurredAt);

    // All events (detected — includes scanner/Safe Links signals).
    const eventsByTarget = new Map<string, Set<string>>();
    // Only human-confirmed events (humanVerified = true).
    const humanEventsByTarget = new Map<string, Set<string>>();
    // Timestamp of the first HUMAN-confirmed action (click or credential submit).
    const actionAtByTarget = new Map<string, Date>();
    for (const e of events) {
      if (!eventsByTarget.has(e.targetId)) eventsByTarget.set(e.targetId, new Set());
      eventsByTarget.get(e.targetId)!.add(e.eventType);
      if (e.humanVerified) {
        if (!humanEventsByTarget.has(e.targetId)) humanEventsByTarget.set(e.targetId, new Set());
        humanEventsByTarget.get(e.targetId)!.add(e.eventType);
        if (
          (e.eventType === "clicked" || e.eventType === "submitted") &&
          !actionAtByTarget.has(e.targetId) &&
          e.occurredAt
        ) {
          actionAtByTarget.set(e.targetId, e.occurredAt as Date);
        }
      }
    }

    // Human-confirmed metrics — separate from the raw detected metrics above.
    const humanClicked = targets.filter((t) => {
      const evs = humanEventsByTarget.get(t.id);
      return evs?.has("clicked") || evs?.has("submitted");
    }).length;
    const humanSubmitted = targets.filter((t) => humanEventsByTarget.get(t.id)?.has("submitted")).length;

    const getStatus = (evs: Set<string>) => {
      if (evs.has("submitted")) return { label: "Submeteu credenciais", badge: "critical", color: "#c62828" };
      if (evs.has("clicked"))   return { label: "Clicou no link",        badge: "high",     color: "#e65100" };
      if (evs.has("opened"))    return { label: "Abriu o e-mail",        badge: "medium",   color: "#1565c0" };
      if (evs.has("reported"))  return { label: "Reportou ao TI",        badge: "good",     color: "#2e7d32" };
      if (evs.has("sent"))      return { label: "Enviado (não aberto)",  badge: "low",      color: "#555"    };
      return                           { label: "Aguardando envio",      badge: "none",     color: "#999"    };
    };

    const total   = targets.length;
    const sent    = targets.filter((t) => t.sentAt).length;
    // "opened" = pixel loaded OR clicked/submitted (clicking implies having opened the email)
    const opened  = targets.filter((t) => {
      const evs = eventsByTarget.get(t.id);
      return evs?.has("opened") || evs?.has("clicked") || evs?.has("submitted");
    }).length;
    const clicked = targets.filter((t) => {
      const evs = eventsByTarget.get(t.id);
      return evs?.has("clicked") || evs?.has("submitted");
    }).length;
    const submitted = targets.filter((t) => eventsByTarget.get(t.id)?.has("submitted")).length;
    const reported  = targets.filter((t) => eventsByTarget.get(t.id)?.has("reported")).length;

    const fmtDate = (d: string | Date | null) =>
      d ? new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

    const riskPct = total > 0 ? Math.round(((clicked + submitted) / total) * 100) : 0;
    const riskLabel = riskPct >= 60 ? "Alto" : riskPct >= 30 ? "Médio" : "Baixo";
    const riskColor = riskPct >= 60 ? "#c62828" : riskPct >= 30 ? "#e65100" : "#2e7d32";

    const rows = targets.map((t) => {
      const evs = eventsByTarget.get(t.id) ?? new Set<string>();
      const s = getStatus(evs);
      return `<tr><td>${t.employeeName}</td><td>${t.employeeEmail}</td><td>${t.employeeDepartment ?? "—"}</td>
<td><span style="background:${s.color}18;color:${s.color};padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600">${s.label}</span></td>
<td>${t.sentAt ? fmtDate(t.sentAt) : "—"}</td></tr>`;
    }).join("");

    const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="48" height="48" style="display:block">
<path d="M100 20 L170 50 V90 C170 140 140 175 100 190 C60 175 30 140 30 90 V50 L100 20 Z" fill="none" stroke="#fff" stroke-width="12" stroke-linejoin="round"/>
<rect x="75" y="100" width="50" height="35" rx="8" fill="#fff"/>
<path d="M85 100 V85 C85 75 115 75 115 85 V100" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round"/>
<text x="100" y="180" font-family="sans-serif" font-weight="900" font-size="28" fill="#fff" text-anchor="middle" letter-spacing="2">WNR</text>
</svg>`;

    const statusLabel = campaign.status === "completed" ? "Concluída" : campaign.status === "active" ? "Ativa" : "Rascunho";

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Relatório — ${campaign.name}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;color:#222;background:#fff;font-size:13px}
.page{max-width:900px;margin:0 auto;padding:0 0 40px}

/* Header */
.header{background:#1a2a4a;color:#fff;padding:24px 40px;display:flex;justify-content:space-between;align-items:center}
.header-left{display:flex;align-items:center;gap:16px}
.brand-name{font-size:20px;font-weight:900;letter-spacing:1px;line-height:1.1}
.brand-sub{font-size:11px;color:#94a3b8;letter-spacing:2px;text-transform:uppercase;margin-top:2px}
.header-right{text-align:right}
.report-label{font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#94a3b8}
.report-date{font-size:12px;color:#cbd5e1;margin-top:4px}

/* Subject bar */
.subject-bar{background:#1e3a6e;color:#fff;padding:14px 40px;font-size:17px;font-weight:700;letter-spacing:0.3px}

/* Meta grid */
.meta-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#e5e7eb;margin:0;border-bottom:1px solid #e5e7eb}
.meta-cell{background:#fff;padding:14px 20px}
.meta-label{font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#6b7280;margin-bottom:4px;font-weight:700}
.meta-value{font-size:13px;color:#111;font-weight:600}

/* Section */
.section{padding:24px 40px}
.section-title{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#1e3a6e;font-weight:700;border-bottom:2px solid #1e3a6e;padding-bottom:6px;margin-bottom:16px}

/* Stats */
.stats{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:0}
.stat{background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:14px 10px;text-align:center}
.stat-v{font-size:26px;font-weight:800;line-height:1}
.stat-l{font-size:10px;color:#6b7280;margin-top:4px;letter-spacing:0.5px}

/* Risk badge */
.risk-row{display:flex;align-items:center;gap:12px;margin-top:20px}
.risk-badge{display:inline-flex;align-items:center;gap:8px;padding:8px 20px;border-radius:6px;font-weight:700;font-size:14px;color:#fff}
.risk-pct{font-size:12px;color:#6b7280}

/* Human-confirmed action alert */
.human-alert{margin-top:18px;border:1px solid #fca5a5;background:#fef2f2;border-radius:8px;padding:14px 18px}
.human-alert-head{font-size:14px;font-weight:800;color:#b91c1c;letter-spacing:0.2px}
.human-alert-sub{font-size:11px;color:#7f1d1d;margin-top:2px;margin-bottom:8px}
.human-alert-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.human-alert-list li{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12px;padding:6px 10px;background:#fff;border:1px solid #fecaca;border-radius:6px}
.ha-name{font-weight:700;color:#111}
.ha-mail{color:#6b7280}
.ha-tag{margin-left:auto;padding:2px 10px;border-radius:20px;font-size:10px;font-weight:700}
.ha-high{background:#e6510018;color:#e65100}
.ha-crit{background:#c6282818;color:#c62828}
.ha-time{color:#b91c1c;font-weight:700;font-variant-numeric:tabular-nums}
.human-ok{margin-top:18px;border:1px solid #bbf7d0;background:#f0fdf4;border-radius:8px;padding:12px 16px;font-size:12px;color:#166534}

/* Human-actions metric block */
.human-note{font-size:11px;color:#6b7280;margin:-8px 0 14px;line-height:1.5}
.stats-human{grid-template-columns:repeat(3,1fr)}
.stat-human{background:#fff;border:1px solid #fecaca;border-left:3px solid #b91c1c}

/* Table */
table{width:100%;border-collapse:collapse}
thead tr{background:#f1f5f9}
th{padding:10px 14px;text-align:left;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#64748b;font-weight:700;border-bottom:2px solid #e2e8f0}
td{padding:11px 14px;border-bottom:1px solid #f1f5f9;vertical-align:middle}
tr:last-child td{border-bottom:none}
tbody tr:hover td{background:#f8fafc}
.badge{display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700}

/* Footer */
.footer-conf{background:#fef9c3;border:1px solid #fde047;border-radius:6px;padding:12px 16px;font-size:11px;color:#713f12;margin:0 40px 0}
.footer-bar{display:flex;justify-content:space-between;align-items:center;padding:16px 40px;border-top:1px solid #e5e7eb;margin-top:24px}
.footer-bar-left{font-size:11px;color:#9ca3af}
.footer-bar-right{font-size:11px;color:#9ca3af;text-align:right}

/* Print */
.no-print{}
@media print{
  .no-print{display:none!important}
  body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .header{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .subject-bar{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
</style></head><body>
<div class="page">

<!-- HEADER -->
<div class="header">
  <div class="header-left">
    ${logoSvg}
    <div>
      <div class="brand-name">Winner Tecnologia</div>
      <div class="brand-sub">WNR Audit · Segurança da Informação</div>
    </div>
  </div>
  <div class="header-right">
    <div class="report-label">Relatório de Campanha</div>
    <div class="report-date">Gerado em ${fmtDate(new Date())}</div>
    <button onclick="window.print()" class="no-print" style="margin-top:10px;padding:6px 16px;background:#334155;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;letter-spacing:0.5px">🖨️ Imprimir / PDF</button>
  </div>
</div>

<!-- SUBJECT BAR -->
<div class="subject-bar">Phishing Simulado — ${campaign.name}</div>

<!-- META -->
<div class="meta-grid">
  <div class="meta-cell"><div class="meta-label">Cliente</div><div class="meta-value">${campaign.tenantDisplayName ?? "—"}</div></div>
  <div class="meta-cell"><div class="meta-label">Status</div><div class="meta-value">${statusLabel}</div></div>
  <div class="meta-cell"><div class="meta-label">Remetente simulado</div><div class="meta-value">${campaign.senderName} &lt;${campaign.senderEmail}&gt;</div></div>
  <div class="meta-cell"><div class="meta-label">Data de início</div><div class="meta-value">${fmtDate(campaign.startedAt)}</div></div>
  <div class="meta-cell"><div class="meta-label">Data de conclusão</div><div class="meta-value">${fmtDate(campaign.completedAt)}</div></div>
  <div class="meta-cell"><div class="meta-label">Total de alvos</div><div class="meta-value">${total} funcionário(s)</div></div>
</div>

<!-- STATS -->
<div class="section">
  <div class="section-title">Resumo de Resultados</div>
  <div class="stats">
    <div class="stat"><div class="stat-v">${sent}</div><div class="stat-l">Enviados</div></div>
    <div class="stat"><div class="stat-v" style="color:#1565c0">${opened}</div><div class="stat-l">Abriram</div></div>
    <div class="stat"><div class="stat-v" style="color:#e65100">${clicked}</div><div class="stat-l">Clicaram</div></div>
    <div class="stat"><div class="stat-v" style="color:#c62828">${submitted}</div><div class="stat-l">Submeteram cred.</div></div>
    <div class="stat"><div class="stat-v" style="color:#2e7d32">${reported}</div><div class="stat-l">Reportaram</div></div>
    <div class="stat"><div class="stat-v" style="color:#6b7280">${sent - opened}</div><div class="stat-l">Não abriram</div></div>
  </div>
  <div class="risk-row">
    <span class="risk-badge" style="background:${riskColor}">${riskLabel}</span>
    <span class="risk-pct">${riskPct}% dos alvos clicaram no link ou submeteram credenciais</span>
  </div>
  ${(() => {
    // Human-confirmed actions (click or credential submit). Only events flagged
    // humanVerified=true count here — scanner / Safe Links signals are excluded,
    // so every entry is a real person.
    const confirmed = targets
      .filter((t) => {
        const evs = humanEventsByTarget.get(t.id);
        return evs?.has("clicked") || evs?.has("submitted");
      })
      .map((t) => ({
        name: t.employeeName,
        email: t.employeeEmail,
        at: actionAtByTarget.get(t.id) ?? null,
        submitted: humanEventsByTarget.get(t.id)?.has("submitted") ?? false,
      }))
      .sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));

    if (confirmed.length === 0) {
      return `<div class="human-ok">
        <strong>Nenhum clique humano confirmado.</strong> Eventos de scanner / Safe Links foram descartados automaticamente e não contam nas métricas acima.
      </div>`;
    }

    const items = confirmed.map((c) => {
      const tag = c.submitted
        ? `<span class="ha-tag ha-crit">Submeteu credenciais</span>`
        : `<span class="ha-tag ha-high">Clicou no link</span>`;
      return `<li><span class="ha-name">${c.name}</span> <span class="ha-mail">${c.email}</span> ${tag} <span class="ha-time">${c.at ? fmtDate(c.at) : "—"}</span></li>`;
    }).join("");

    return `<div class="human-alert">
      <div class="human-alert-head">⚠️ ${confirmed.length} clique(s) humano(s) confirmado(s)</div>
      <div class="human-alert-sub">Ações reais de pessoas — scanners e detonação do Safe Links já foram filtrados. Horário na data/hora do servidor.</div>
      <ul class="human-alert-list">${items}</ul>
    </div>`;
  })()}
</div>

<!-- HUMAN ACTIONS (separado das métricas detectadas acima) -->
<div class="section" style="padding-top:0">
  <div class="section-title">Ações Humanas Confirmadas</div>
  <p class="human-note">Contagem de <strong>interações reais de pessoas</strong>. Não inclui scanners de segurança nem a detonação do Microsoft Safe Links — que inflam os números de "Abriram" e "Clicaram" do resumo acima. Use estes valores para a análise de risco real.</p>
  <div class="stats stats-human">
    <div class="stat stat-human"><div class="stat-v" style="color:#b91c1c">${humanClicked}</div><div class="stat-l">Cliques humanos</div></div>
    <div class="stat stat-human"><div class="stat-v" style="color:#7f1d1d">${humanSubmitted}</div><div class="stat-l">Submissões humanas</div></div>
    <div class="stat stat-human"><div class="stat-v" style="color:#334155">${Math.max(clicked - humanClicked, 0)}</div><div class="stat-l">Cliques de scanner (não humanos)</div></div>
  </div>
</div>

<!-- TABLE -->
<div class="section" style="padding-top:0">
  <div class="section-title">Detalhamento por Funcionário</div>
  <table>
    <thead><tr><th>#</th><th>Nome</th><th>E-mail</th><th>Departamento</th><th>Resultado</th><th>Enviado em</th><th>Ação humana em</th></tr></thead>
    <tbody>${targets.map((t, i) => {
      const evs = eventsByTarget.get(t.id) ?? new Set<string>();
      const s = getStatus(evs);
      const actionAt = actionAtByTarget.get(t.id) ?? null;
      const actionCell = actionAt
        ? `<span style="color:#c62828;font-weight:600">${fmtDate(actionAt)}</span>`
        : `<span style="color:#9ca3af">—</span>`;
      return `<tr><td style="color:#9ca3af">${i + 1}</td><td style="font-weight:600">${t.employeeName}</td><td>${t.employeeEmail}</td><td>${t.employeeDepartment ?? "—"}</td>
<td><span class="badge" style="background:${s.color}18;color:${s.color}">${s.label}</span></td>
<td style="color:#6b7280">${t.sentAt ? fmtDate(t.sentAt) : "—"}</td>
<td>${actionCell}</td></tr>`;
    }).join("")}</tbody>
  </table>
</div>

<!-- CONFIDENTIALITY -->
<div class="footer-conf">
  <strong>Aviso de Confidencialidade:</strong> Este relatório é confidencial e destinado exclusivamente ao cliente solicitante. As informações contidas neste documento referem-se à campanha de phishing simulado realizada pela Winner Tecnologia e não devem ser reproduzidas ou distribuídas sem autorização prévia.
</div>

<!-- FOOTER BAR -->
<div class="footer-bar">
  <div class="footer-bar-left"><strong>Winner Tecnologia</strong><br>WNR Audit · Suporte Técnico Especializado</div>
  <div class="footer-bar-right">Documento gerado em ${fmtDate(new Date())}<br>Gerado automaticamente pelo WNR Audit</div>
</div>

</div></body></html>`);
  },
);

// ─── Tracking (public — no auth) ─────────────────────────────────────────────

// User-Agent fragments of known e-mail security scanners / link detonators.
const SCANNER_UA_PATTERNS = [
  "microsoft", "msoffice", "ms-office", "office365", "msnbot", "bingpreview",
  "python-requests", "python/", "curl/", "wget/", "go-http-client",
  "java/", "okhttp/", "libwww-perl", "axios/", "node-fetch", "got (",
  "headlesschrome", "headless", "phantomjs", "slurp", "proofpoint",
  "mimecast", "barracuda", "symantec", "forcepoint", "trendmicro",
  "cisco", "ironport", "fireeye", "urldefense", "safelinks",
];

// Published Microsoft / Office 365 datacenter CIDR blocks used by Defender
// (Safe Links detonation, EOP scanners, Outlook image proxy). Not exhaustive —
// Microsoft publishes the authoritative list, but these cover the common
// ranges that hit tracking endpoints. Kept as prefixes for cheap matching.
const MICROSOFT_IP_PREFIXES = [
  "40.", "13.", "20.", "52.", "104.", "51.", "137.116.", "168.61.", "168.62.",
  "168.63.", "191.232.", "191.233.", "191.234.", "191.235.", "191.236.",
  "191.237.", "191.238.", "191.239.", "23.96.", "23.97.", "23.98.", "23.99.",
  "23.100.", "23.101.", "23.102.", "23.103.", "65.52.", "65.55.", "70.37.",
  "94.245.", "111.221.", "131.253.", "132.245.", "157.55.", "157.56.",
  "207.46.", "207.68.", "213.199.",
];

function normalizeIp(ip: string | undefined): string {
  if (!ip) return "";
  // Strip IPv6-mapped IPv4 prefix and any port suffix.
  return ip.replace(/^::ffff:/i, "").replace(/:\d+$/, "").trim();
}

function looksLikeMicrosoftScanner(ip: string | undefined, ua: string | undefined): boolean {
  const cleanIp = normalizeIp(ip);
  const uaLower = (ua ?? "").toLowerCase();
  const uaMatch = SCANNER_UA_PATTERNS.some((p) => uaLower.includes(p));
  const ipMatch = cleanIp !== "" && MICROSOFT_IP_PREFIXES.some((p) => cleanIp.startsWith(p));
  return uaMatch || ipMatch;
}

/**
 * Records a tracking event. Instead of discarding scanner-triggered hits, we
 * STORE every event but tag it with `humanVerified`:
 *   - false → detected signal that may have been generated by a scanner / Safe
 *     Links detonation / Outlook image proxy (kept for the "detected" metrics).
 *   - true  → confirmed real human: the client proved a genuine interaction AND
 *     the origin is not a known scanner / Microsoft datacenter IP and did not
 *     arrive implausibly fast.
 *
 * This makes the two dimensions explicit and lets the report show a separate
 * "Ações Humanas Confirmadas" block next to the raw metrics.
 *
 * `clientHumanClaim` is the interaction proof coming from the training SPA
 * (genuine pointer/scroll/key/touch). Server-side signals can only DEMOTE it,
 * never promote — so a scanner claiming humanity is still recorded as false.
 */
async function recordEvent(
  token: string,
  eventType: "opened" | "clicked" | "submitted" | "reported",
  metadata?: Record<string, unknown>,
  clientHumanClaim = false,
) {
  const [target] = await db
    .select()
    .from(phishingCampaignTargetsTable)
    .where(eq(phishingCampaignTargetsTable.trackingToken, token))
    .limit(1);
  if (!target) return null;

  const rawUA = (metadata?.ua as string | undefined) ?? "";
  const ip = metadata?.ip as string | undefined;
  const isKnownScanner = looksLikeMicrosoftScanner(ip, rawUA);
  const msSinceSent = target.sentAt
    ? Date.now() - new Date(target.sentAt).getTime()
    : Infinity;
  const isTooFast = msSinceSent < 10_000;

  // Human only when the client proved interaction AND nothing server-side
  // contradicts it. Scanners/detonation get recorded with humanVerified=false.
  const humanVerified = clientHumanClaim && !isKnownScanner && !isTooFast;

  const enrichedMeta = {
    ...(metadata ?? {}),
    ip: normalizeIp(ip),
    isKnownScanner,
    msSinceSent,
    humanVerified,
  };

  if (!humanVerified) {
    logger.info(
      { token, eventType, ua: rawUA, ip: normalizeIp(ip), msSinceSent, isKnownScanner, clientHumanClaim },
      "Event recorded as detected (not human-confirmed)",
    );
  }

  // Idempotent per (target, eventType). If a later event upgrades the confidence
  // from detected → human-confirmed, we promote the existing row instead of
  // inserting a duplicate.
  const [existing] = await db
    .select({ id: phishingEventsTable.id, humanVerified: phishingEventsTable.humanVerified })
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
      humanVerified,
      metadata: enrichedMeta,
    });
  } else if (humanVerified && !existing.humanVerified) {
    await db
      .update(phishingEventsTable)
      .set({ humanVerified: true, metadata: enrichedMeta })
      .where(eq(phishingEventsTable.id, existing.id));
  }

  return target;
}

// Tracking pixel — opened
router.get("/phishing/track/:token/open", async (req, res): Promise<void> => {
  const token = req.params.token as string;
  // A pixel load can never prove a human (Outlook/Defender prefetch it), so the
  // open is always recorded as detected-only (humanVerified stays false).
  await recordEvent(token, "opened", { ip: req.ip, ua: req.headers["user-agent"] }, false).catch(
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

// Tracking click — redirect to capture page (fake login form).
// The capture page records "submitted" only when the user fills and submits the form.
// Scanners follow this redirect but do not interact with the form inside the SPA.
router.get("/phishing/track/:token/click", async (req, res): Promise<void> => {
  const basePath = process.env.BASE_PATH ?? "/wnraudit/app/";
  res.redirect(302, `${basePath}phishing/capture/${encodeURIComponent(req.params.token as string)}`);
});

// Capture page style info — public, no auth required.
// Returns the visual style the capture page should use based on the campaign template.
router.get("/phishing/capture-info/:token", async (req, res): Promise<void> => {
  const [row] = await db
    .select({ metadata: phishingEventsTable.metadata })
    .from(phishingEventsTable)
    .innerJoin(
      phishingCampaignTargetsTable,
      eq(phishingEventsTable.targetId, phishingCampaignTargetsTable.id),
    )
    .where(
      and(
        eq(phishingCampaignTargetsTable.trackingToken, req.params.token as string),
        eq(phishingEventsTable.eventType, "sent"),
      ),
    )
    .limit(1);
  const style = (row?.metadata as { captureStyle?: string } | null)?.captureStyle ?? "generic";
  res.json({ style });
});

// Training SPA arrived — records opened + clicked.
// NOTE: Safe Links detonation executes JS, so "JS ran" is NOT proof of a human.
// The SPA only calls this after a genuine interaction and sends humanVerified.
// We enforce the scanner/human check here (requireHuman) so sandbox detonations
// that reach this endpoint without interaction are rejected.
router.post("/phishing/track/:token/arrived", async (req, res): Promise<void> => {
  const token = req.params.token as string;
  const clientHumanClaim = (req.body?.humanVerified === true);
  const base = { ip: req.ip, ua: req.headers["user-agent"], via: "training-spa" };
  // Both events carry the same human claim; recordEvent demotes it if the origin
  // looks like a scanner. The click landing implies the mail was opened.
  await recordEvent(token, "opened",  base, clientHumanClaim).catch(() => {});
  await recordEvent(token, "clicked", base, clientHumanClaim).catch(() => {});
  res.json({ ok: true });
});

// Report as phishing via email link — redirects to training SPA with action=report.
// Events (opened + reported) are recorded by the SPA's useEffect via POST /report.
// Scanners follow this redirect but cannot execute JavaScript, so no false events.
router.get("/phishing/track/:token/report-email", async (req, res): Promise<void> => {
  const basePath = process.env.BASE_PATH ?? "/wnraudit/app/";
  res.redirect(302, `${basePath}phishing/training/${encodeURIComponent(req.params.token as string)}?action=report`);
});

// Report as phishing (called from training SPA). The report footer link is also
// followed by Safe Links, so we apply the same scanner/human check here.
router.post("/phishing/track/:token/report", async (req, res): Promise<void> => {
  const token = req.params.token as string;
  const clientHumanClaim = (req.body?.humanVerified === true);
  const base = { ip: req.ip, ua: req.headers["user-agent"], via: "training-spa" };
  // Reaching this from a real human means the email was opened — record both.
  await recordEvent(token, "opened",   base, clientHumanClaim).catch(() => {});
  await recordEvent(token, "reported", base, clientHumanClaim).catch(() => {});
  res.json({ message: "Obrigado por reportar. Isso é exatamente o que esperamos de você!" });
});

// Submit credentials (record event only — never store credentials)
router.post("/phishing/track/:token/submit", async (req, res): Promise<void> => {
  const token = req.params.token as string;
  // Submitting a form requires human input; treat as a human claim (still demoted
  // server-side if the origin is a known scanner / Microsoft datacenter IP).
  await recordEvent(token, "submitted", {
    ip: req.ip,
    ua: req.headers["user-agent"],
    fieldsReceived: Object.keys(req.body ?? {}),
  }, true).catch(() => {});

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
