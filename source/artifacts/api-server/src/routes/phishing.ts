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
  phishingSmtpConfigsTable,
  awarenessModulesTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { sendPhishingEmail, verifySmtpCredentials } from "../lib/phishingMailer";
import { logger } from "../lib/logger";
import { decryptSecret, encryptSecret } from "../lib/msProvisioner";
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

// ─── SMTP Configs ─────────────────────────────────────────────────────────────

router.get("/phishing/smtp", requireAuth, async (req, res): Promise<void> => {
  const customer = req.customer!;
  const configs = await db
    .select({
      id: phishingSmtpConfigsTable.id,
      displayName: phishingSmtpConfigsTable.displayName,
      email: phishingSmtpConfigsTable.email,
      smtpHost: phishingSmtpConfigsTable.smtpHost,
      smtpPort: phishingSmtpConfigsTable.smtpPort,
      smtpUser: phishingSmtpConfigsTable.smtpUser,
      status: phishingSmtpConfigsTable.status,
      lastTestedAt: phishingSmtpConfigsTable.lastTestedAt,
      createdAt: phishingSmtpConfigsTable.createdAt,
    })
    .from(phishingSmtpConfigsTable)
    .where(eq(phishingSmtpConfigsTable.customerId, customer.id))
    .orderBy(desc(phishingSmtpConfigsTable.createdAt));
  res.json(configs);
});

router.post("/phishing/smtp", requireAuth, async (req, res): Promise<void> => {
  const parsed = z
    .object({
      displayName: z.string().min(1),
      email: z.string().email(),
      smtpHost: z.string().min(1),
      smtpPort: z.number().int().min(1).max(65535).default(587),
      smtpUser: z.string().min(1),
      smtpPass: z.string().min(1),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const customer = req.customer!;
  const { smtpPass, ...rest } = parsed.data;
  const [created] = await db
    .insert(phishingSmtpConfigsTable)
    .values({
      customerId: customer.id,
      ...rest,
      encryptedSmtpPass: encryptSecret(smtpPass),
      status: "pending",
    })
    .returning({
      id: phishingSmtpConfigsTable.id,
      displayName: phishingSmtpConfigsTable.displayName,
      email: phishingSmtpConfigsTable.email,
      smtpHost: phishingSmtpConfigsTable.smtpHost,
      smtpPort: phishingSmtpConfigsTable.smtpPort,
      smtpUser: phishingSmtpConfigsTable.smtpUser,
      status: phishingSmtpConfigsTable.status,
      lastTestedAt: phishingSmtpConfigsTable.lastTestedAt,
      createdAt: phishingSmtpConfigsTable.createdAt,
    });
  res.status(201).json(created);
});

router.patch("/phishing/smtp/:id", requireAuth, async (req, res): Promise<void> => {
  const parsed = z
    .object({
      displayName: z.string().min(1).optional(),
      email: z.string().email().optional(),
      smtpHost: z.string().min(1).optional(),
      smtpPort: z.number().int().min(1).max(65535).optional(),
      smtpUser: z.string().min(1).optional(),
      smtpPass: z.string().min(1).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const customer = req.customer!;
  const { smtpPass, ...rest } = parsed.data;
  const updates: Record<string, unknown> = {
    ...rest,
    status: "pending",
    updatedAt: new Date(),
  };
  if (smtpPass) updates.encryptedSmtpPass = encryptSecret(smtpPass);

  const [updated] = await db
    .update(phishingSmtpConfigsTable)
    .set(updates)
    .where(
      and(
        eq(phishingSmtpConfigsTable.id, req.params.id as string),
        eq(phishingSmtpConfigsTable.customerId, customer.id),
      ),
    )
    .returning({
      id: phishingSmtpConfigsTable.id,
      displayName: phishingSmtpConfigsTable.displayName,
      email: phishingSmtpConfigsTable.email,
      smtpHost: phishingSmtpConfigsTable.smtpHost,
      smtpPort: phishingSmtpConfigsTable.smtpPort,
      smtpUser: phishingSmtpConfigsTable.smtpUser,
      status: phishingSmtpConfigsTable.status,
      lastTestedAt: phishingSmtpConfigsTable.lastTestedAt,
      createdAt: phishingSmtpConfigsTable.createdAt,
    });
  if (!updated) {
    res.status(404).json({ error: "Configuração SMTP não encontrada" });
    return;
  }
  res.json(updated);
});

router.post("/phishing/smtp/:id/test", requireAuth, async (req, res): Promise<void> => {
  const customer = req.customer!;
  const [config] = await db
    .select()
    .from(phishingSmtpConfigsTable)
    .where(
      and(
        eq(phishingSmtpConfigsTable.id, req.params.id as string),
        eq(phishingSmtpConfigsTable.customerId, customer.id),
      ),
    );
  if (!config) {
    res.status(404).json({ error: "Configuração SMTP não encontrada" });
    return;
  }
  try {
    const pass = decryptSecret(config.encryptedSmtpPass);
    await verifySmtpCredentials({ host: config.smtpHost, port: config.smtpPort, user: config.smtpUser, pass });
    await db
      .update(phishingSmtpConfigsTable)
      .set({ status: "verified", lastTestedAt: new Date(), updatedAt: new Date() })
      .where(eq(phishingSmtpConfigsTable.id, config.id));
    res.json({ ok: true, status: "verified" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(phishingSmtpConfigsTable)
      .set({ status: "failed", lastTestedAt: new Date(), updatedAt: new Date() })
      .where(eq(phishingSmtpConfigsTable.id, config.id));
    res.status(422).json({ ok: false, status: "failed", error: message });
  }
});

router.delete("/phishing/smtp/:id", requireAuth, async (req, res): Promise<void> => {
  const customer = req.customer!;
  const [deleted] = await db
    .delete(phishingSmtpConfigsTable)
    .where(
      and(
        eq(phishingSmtpConfigsTable.id, req.params.id as string),
        eq(phishingSmtpConfigsTable.customerId, customer.id),
      ),
    )
    .returning({ id: phishingSmtpConfigsTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Configuração SMTP não encontrada" });
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

    // Resolve SMTP config for this campaign's sender email (if configured in DB)
    const [smtpConfig] = await db
      .select()
      .from(phishingSmtpConfigsTable)
      .where(
        and(
          eq(phishingSmtpConfigsTable.customerId, customer.id),
          eq(phishingSmtpConfigsTable.email, campaign.senderEmail),
          eq(phishingSmtpConfigsTable.status, "verified"),
        ),
      )
      .limit(1);

    const smtpCreds = smtpConfig
      ? { host: smtpConfig.smtpHost, port: smtpConfig.smtpPort, user: smtpConfig.smtpUser, pass: decryptSecret(smtpConfig.encryptedSmtpPass) }
      : undefined; // falls back to env SMTP_HOST/USER/PASS

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
            smtpCreds,
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

    // All events — includes scanner/Safe Links signals (used for "detected" metrics).
    const eventsByTarget = new Map<string, Set<string>>();
    // Human-confirmed events only (humanVerified = true).
    const humanEventsByTarget = new Map<string, Set<string>>();
    // Timestamp of first human action (clicked, submitted, or reported).
    const actionAtByTarget = new Map<string, Date>();

    for (const e of events) {
      if (!eventsByTarget.has(e.targetId)) eventsByTarget.set(e.targetId, new Set());
      eventsByTarget.get(e.targetId)!.add(e.eventType);

      // "reported" is trusted regardless of humanVerified — it requires explicit navigation + button
      const trustAsHuman = e.humanVerified || e.eventType === "reported";
      if (trustAsHuman) {
        if (!humanEventsByTarget.has(e.targetId)) humanEventsByTarget.set(e.targetId, new Set());
        humanEventsByTarget.get(e.targetId)!.add(e.eventType);
        if (
          (e.eventType === "clicked" || e.eventType === "submitted" || e.eventType === "reported") &&
          !actionAtByTarget.has(e.targetId) &&
          e.occurredAt
        ) {
          actionAtByTarget.set(e.targetId, e.occurredAt as Date);
        }
      }
    }

    // Human-confirmed risk metrics.
    const humanClicked   = targets.filter((t) => { const evs = humanEventsByTarget.get(t.id); return evs?.has("clicked") || evs?.has("submitted"); }).length;
    const humanSubmitted = targets.filter((t) => humanEventsByTarget.get(t.id)?.has("submitted")).length;
    const humanReported  = targets.filter((t) => humanEventsByTarget.get(t.id)?.has("reported")).length;

    // Priority order (matches campaign-detail.tsx): submitted > clicked > reported > opened
    const getStatus = (targetId: string) => {
      const all   = eventsByTarget.get(targetId)   ?? new Set<string>();
      const human = humanEventsByTarget.get(targetId) ?? new Set<string>();
      if (human.has("submitted")) return { label: "Submeteu credenciais", color: "#c62828" };
      if (human.has("clicked"))   return { label: "Clicou no link",        color: "#e65100" };
      if (all.has("reported"))    return { label: "Reportou ao TI",        color: "#2e7d32" };
      if (all.has("opened") || all.has("clicked") || all.has("submitted"))
                                  return { label: "Abriu o e-mail",        color: "#1565c0" };
      if (all.has("sent"))        return { label: "Enviado / Não aberto",  color: "#6b7280" };
      return                             { label: "Aguardando envio",      color: "#9ca3af" };
    };

    const total     = targets.length;
    const sent      = targets.filter((t) => t.sentAt).length;
    const opened    = targets.filter((t) => {
      const evs = eventsByTarget.get(t.id);
      return evs?.has("opened") || evs?.has("clicked") || evs?.has("submitted") || evs?.has("reported");
    }).length;
    const clicked   = targets.filter((t) => { const evs = eventsByTarget.get(t.id); return evs?.has("clicked") || evs?.has("submitted"); }).length;
    const submitted = targets.filter((t) => eventsByTarget.get(t.id)?.has("submitted")).length;
    const reported  = targets.filter((t) => eventsByTarget.get(t.id)?.has("reported")).length;

    const fmtDate = (d: string | Date | null) =>
      d ? new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

    // Risk is based on HUMAN-confirmed clicks/submits only.
    const riskPct   = total > 0 ? Math.round((humanClicked / total) * 100) : 0;
    const riskLabel = riskPct >= 60 ? "Alto" : riskPct >= 30 ? "Médio" : riskPct > 0 ? "Baixo" : "Nenhum";
    const riskColor = riskPct >= 60 ? "#c62828" : riskPct >= 30 ? "#e65100" : riskPct > 0 ? "#f59e0b" : "#2e7d32";

    const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="44" height="44" style="display:block">
<path d="M100 20 L170 50 V90 C170 140 140 175 100 190 C60 175 30 140 30 90 V50 L100 20 Z" fill="none" stroke="#fff" stroke-width="12" stroke-linejoin="round"/>
<rect x="75" y="100" width="50" height="35" rx="8" fill="#fff"/>
<path d="M85 100 V85 C85 75 115 75 115 85 V100" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round"/>
</svg>`;

    const statusLabel = campaign.status === "completed" ? "Concluída" : campaign.status === "active" ? "Ativa" : "Rascunho";

    // Confirmed risk actors (clicked or submitted) — human only.
    const riskActors = targets
      .filter((t) => { const evs = humanEventsByTarget.get(t.id); return evs?.has("clicked") || evs?.has("submitted"); })
      .map((t) => ({
        name: t.employeeName, email: t.employeeEmail,
        at: actionAtByTarget.get(t.id) ?? null,
        submitted: humanEventsByTarget.get(t.id)?.has("submitted") ?? false,
      }))
      .sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));

    // People who showed correct behavior (reported).
    const reporters = targets
      .filter((t) => eventsByTarget.get(t.id)?.has("reported"))
      .map((t) => ({ name: t.employeeName, email: t.employeeEmail, at: actionAtByTarget.get(t.id) ?? null }))
      .sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Relatório — ${campaign.name}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;color:#1e293b;background:#fff;font-size:13px;line-height:1.5}
.page{max-width:860px;margin:0 auto;padding-bottom:40px}

/* ── Header ── */
.hdr{background:#0f2044;color:#fff;padding:22px 36px;display:flex;justify-content:space-between;align-items:center}
.hdr-left{display:flex;align-items:center;gap:14px}
.brand{font-size:18px;font-weight:800;letter-spacing:.5px}
.brand-sub{font-size:10px;color:#94a3b8;letter-spacing:2px;text-transform:uppercase;margin-top:2px}
.hdr-right{text-align:right;font-size:11px;color:#94a3b8}
.hdr-right strong{display:block;color:#e2e8f0;font-size:13px;margin-bottom:2px}

/* ── Campaign title bar ── */
.title-bar{background:#1e3a6e;color:#fff;padding:13px 36px;font-size:16px;font-weight:700}

/* ── Info grid ── */
.info-grid{display:grid;grid-template-columns:repeat(3,1fr);border-bottom:1px solid #e2e8f0}
.info-cell{padding:13px 20px;border-right:1px solid #e2e8f0}
.info-cell:last-child,.info-cell:nth-child(3){border-right:none}
.info-label{font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:#94a3b8;font-weight:700;margin-bottom:3px}
.info-value{font-size:12px;color:#1e293b;font-weight:600}

/* ── Section ── */
.sec{padding:22px 36px}
.sec+.sec{padding-top:0}
.sec-title{font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#1e3a6e;font-weight:800;border-bottom:2px solid #1e3a6e;padding-bottom:5px;margin-bottom:14px}

/* ── Risk banner ── */
.risk-banner{display:flex;align-items:center;gap:16px;padding:14px 20px;border-radius:8px;margin-bottom:18px}
.risk-badge{font-size:16px;font-weight:800;color:#fff;padding:6px 18px;border-radius:6px;white-space:nowrap}
.risk-desc{font-size:12px;color:#475569;line-height:1.5}

/* ── Stats ── */
.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}
.stat{border:1px solid #e2e8f0;border-radius:8px;padding:14px 8px;text-align:center}
.stat-n{font-size:28px;font-weight:800;line-height:1}
.stat-l{font-size:10px;color:#64748b;margin-top:3px;font-weight:500}

/* ── Alert boxes ── */
.alert-box{border-radius:8px;padding:14px 18px;margin-bottom:12px}
.alert-red{border:1px solid #fca5a5;background:#fef2f2}
.alert-green{border:1px solid #86efac;background:#f0fdf4}
.alert-blue{border:1px solid #bae6fd;background:#f0f9ff}
.alert-head{font-size:13px;font-weight:700;margin-bottom:8px}
.alert-red .alert-head{color:#991b1b}
.alert-green .alert-head{color:#166534}
.alert-blue .alert-head{color:#075985}
.alert-list{list-style:none;display:flex;flex-direction:column;gap:5px}
.alert-list li{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;padding:5px 10px;background:#fff;border-radius:5px}
.al-name{font-weight:700;color:#1e293b;min-width:80px}
.al-mail{color:#64748b;flex:1}
.al-tag{padding:2px 10px;border-radius:20px;font-size:10px;font-weight:700;white-space:nowrap}
.tag-crit{background:#fde8e8;color:#b91c1c}
.tag-high{background:#fff3e0;color:#c2410c}
.tag-good{background:#dcfce7;color:#15803d}
.al-time{color:#64748b;font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}

/* ── Note ── */
.note{font-size:11px;color:#94a3b8;margin-top:6px;font-style:italic}

/* ── Human metrics row ── */
.hm-row{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px}
.hm-card{border-radius:6px;padding:10px 14px;text-align:center}
.hm-n{font-size:22px;font-weight:800;line-height:1}
.hm-l{font-size:10px;margin-top:3px;font-weight:500}
.hm-risk{border:1px solid #fecaca;background:#fef2f2}
.hm-risk .hm-n{color:#b91c1c}
.hm-risk .hm-l{color:#ef4444}
.hm-good{border:1px solid #86efac;background:#f0fdf4}
.hm-good .hm-n{color:#16a34a}
.hm-good .hm-l{color:#22c55e}
.hm-neutral{border:1px solid #e2e8f0;background:#f8fafc}
.hm-neutral .hm-n{color:#475569}
.hm-neutral .hm-l{color:#94a3b8}

/* ── Table ── */
table{width:100%;border-collapse:collapse;font-size:12px}
thead th{padding:9px 12px;text-align:left;font-size:9px;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;font-weight:700;border-bottom:2px solid #e2e8f0;background:#f8fafc}
tbody td{padding:10px 12px;border-bottom:1px solid #f1f5f9;vertical-align:middle}
tbody tr:last-child td{border-bottom:none}
.badge{display:inline-block;padding:3px 11px;border-radius:20px;font-size:11px;font-weight:600}

/* ── Footer ── */
.conf-box{margin:0 36px;padding:11px 14px;background:#fefce8;border:1px solid #fde047;border-radius:6px;font-size:11px;color:#713f12}
.footer{display:flex;justify-content:space-between;padding:14px 36px;border-top:1px solid #e2e8f0;margin-top:20px;font-size:11px;color:#94a3b8}

@media print{
  .no-print{display:none!important}
  body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .hdr,.title-bar{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .risk-banner,.alert-box,.hm-card,.stat{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
</style></head><body><div class="page">

<!-- HEADER -->
<div class="hdr">
  <div class="hdr-left">
    ${logoSvg}
    <div>
      <div class="brand">Winner Tecnologia</div>
      <div class="brand-sub">WNR Audit · Segurança da Informação</div>
    </div>
  </div>
  <div class="hdr-right">
    <strong>Relatório de Campanha de Phishing Simulado</strong>
    Gerado em ${fmtDate(new Date())}
    <button onclick="window.print()" class="no-print" style="display:block;margin-top:8px;padding:5px 14px;background:#334155;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;margin-left:auto">🖨️ Imprimir / PDF</button>
  </div>
</div>

<!-- TITLE BAR -->
<div class="title-bar">Phishing Simulado — ${campaign.name}</div>

<!-- INFO GRID -->
<div class="info-grid">
  <div class="info-cell"><div class="info-label">Cliente</div><div class="info-value">${campaign.tenantDisplayName ?? "—"}</div></div>
  <div class="info-cell"><div class="info-label">Status</div><div class="info-value">${statusLabel}</div></div>
  <div class="info-cell"><div class="info-label">Remetente simulado</div><div class="info-value">${campaign.senderName} &lt;${campaign.senderEmail}&gt;</div></div>
  <div class="info-cell"><div class="info-label">Início</div><div class="info-value">${fmtDate(campaign.startedAt)}</div></div>
  <div class="info-cell"><div class="info-label">Conclusão</div><div class="info-value">${fmtDate(campaign.completedAt)}</div></div>
  <div class="info-cell"><div class="info-label">Total de alvos</div><div class="info-value">${total} funcionário(s)</div></div>
</div>

<!-- RESULTADOS -->
<div class="sec">
  <div class="sec-title">Resultados da Campanha</div>

  <!-- Risk banner -->
  <div class="risk-banner" style="background:${riskColor}12;border:1px solid ${riskColor}40">
    <span class="risk-badge" style="background:${riskColor}">${riskLabel}</span>
    <div class="risk-desc">
      <strong>${humanClicked} de ${total} funcionário(s)</strong> clicaram no link ou submeteram credenciais (ações humanas confirmadas, sem scanner).<br>
      ${humanReported > 0 ? `<strong>${humanReported} funcionário(s) reportaram</strong> o e-mail suspeito ao TI — comportamento correto esperado.` : "Nenhum funcionário reportou o e-mail ao TI."}
    </div>
  </div>

  <!-- Stats row -->
  <div class="stats">
    <div class="stat"><div class="stat-n">${sent}</div><div class="stat-l">Enviados</div></div>
    <div class="stat"><div class="stat-n" style="color:#1565c0">${opened}</div><div class="stat-l">Abriram</div></div>
    <div class="stat"><div class="stat-n" style="color:#e65100">${clicked}</div><div class="stat-l">Clicaram</div></div>
    <div class="stat"><div class="stat-n" style="color:#c62828">${submitted}</div><div class="stat-l">Submeteram cred.</div></div>
    <div class="stat"><div class="stat-n" style="color:#16a34a">${reported}</div><div class="stat-l">Reportaram</div></div>
  </div>
  <p class="note">Abriram / Clicaram incluem detecções de scanners de segurança (Microsoft Safe Links). Os números reais de humanos estão na seção abaixo.</p>

  <!-- Human metrics -->
  <div class="hm-row">
    <div class="hm-card hm-risk"><div class="hm-n">${humanClicked}</div><div class="hm-l">Cliques humanos</div></div>
    <div class="hm-card hm-risk"><div class="hm-n">${humanSubmitted}</div><div class="hm-l">Credenciais submetidas</div></div>
    <div class="hm-card hm-good"><div class="hm-n">${humanReported}</div><div class="hm-l">Reportaram ao TI</div></div>
    <div class="hm-card hm-neutral"><div class="hm-n">${Math.max(clicked - humanClicked, 0)}</div><div class="hm-l">Cliques de scanner</div></div>
  </div>

  <!-- Risk actors -->
  ${riskActors.length > 0 ? `
  <div class="alert-box alert-red" style="margin-top:16px">
    <div class="alert-head">⚠️ Ações de risco confirmadas (${riskActors.length})</div>
    <ul class="alert-list">${riskActors.map((c) => `
      <li>
        <span class="al-name">${c.name}</span>
        <span class="al-mail">${c.email}</span>
        <span class="al-tag ${c.submitted ? "tag-crit" : "tag-high"}">${c.submitted ? "Submeteu credenciais" : "Clicou no link"}</span>
        <span class="al-time">${c.at ? fmtDate(c.at) : "—"}</span>
      </li>`).join("")}
    </ul>
  </div>` : `
  <div class="alert-box alert-blue" style="margin-top:16px">
    <div class="alert-head">✓ Nenhum clique humano confirmado</div>
    <div style="font-size:12px;color:#075985">Eventos de scanner / Safe Links foram descartados. Nenhum funcionário clicou no link de phishing.</div>
  </div>`}

  <!-- Reporters -->
  ${reporters.length > 0 ? `
  <div class="alert-box alert-green">
    <div class="alert-head">✓ Funcionários que reportaram corretamente (${reporters.length})</div>
    <ul class="alert-list">${reporters.map((r) => `
      <li>
        <span class="al-name">${r.name}</span>
        <span class="al-mail">${r.email}</span>
        <span class="al-tag tag-good">Reportou ao TI</span>
        <span class="al-time">${r.at ? fmtDate(r.at) : "—"}</span>
      </li>`).join("")}
    </ul>
  </div>` : ""}
</div>

<!-- DETALHAMENTO -->
<div class="sec">
  <div class="sec-title">Detalhamento por Funcionário</div>
  <table>
    <thead>
      <tr>
        <th>#</th><th>Nome</th><th>E-mail</th><th>Departamento</th>
        <th>Resultado</th><th>Enviado em</th><th>Ação em</th>
      </tr>
    </thead>
    <tbody>${targets.map((t, i) => {
      const s = getStatus(t.id);
      const actionAt = actionAtByTarget.get(t.id) ?? null;
      return `<tr>
        <td style="color:#cbd5e1;font-size:11px">${i + 1}</td>
        <td style="font-weight:600">${t.employeeName}</td>
        <td style="color:#64748b">${t.employeeEmail}</td>
        <td style="color:#64748b">${t.employeeDepartment ?? "—"}</td>
        <td><span class="badge" style="background:${s.color}18;color:${s.color}">${s.label}</span></td>
        <td style="color:#94a3b8;font-size:11px">${t.sentAt ? fmtDate(t.sentAt) : "—"}</td>
        <td style="font-size:11px${actionAt ? ";color:#c62828;font-weight:600" : ";color:#cbd5e1"}">${actionAt ? fmtDate(actionAt) : "—"}</td>
      </tr>`;
    }).join("")}</tbody>
  </table>
</div>

<!-- CONFIDENTIALITY -->
<div class="conf-box">
  <strong>Confidencial:</strong> Este relatório é destinado exclusivamente ao cliente solicitante e não deve ser reproduzido ou distribuído sem autorização prévia. Campanha de phishing simulado realizada pela Winner Tecnologia.
</div>

<!-- FOOTER -->
<div class="footer">
  <div><strong>Winner Tecnologia</strong> · WNR Audit</div>
  <div>Gerado automaticamente em ${fmtDate(new Date())}</div>
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

// First keystroke in capture-page form — proves a human reached and typed into the
// fake login form. Scanners follow the /click redirect but never type in form fields.
router.post("/phishing/track/:token/interact", async (req, res): Promise<void> => {
  const token = req.params.token as string;
  const clientHumanClaim = (req.body?.humanVerified === true);
  const base = { ip: req.ip, ua: req.headers["user-agent"], via: "capture-page" };
  // Typing in the form proves the email was opened and the link was clicked.
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
