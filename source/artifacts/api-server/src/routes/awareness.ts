import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  awarenessModulesTable,
  awarenessCompletionsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

// ─── Built-in modules (seed data) ────────────────────────────────────────────

const BUILTIN_MODULES = [
  {
    title: "Como Identificar Phishing",
    description: "Aprenda os sinais de alerta de e-mails maliciosos e como se proteger.",
    moduleType: "article",
    contentMarkdown: `# Como Identificar E-mails de Phishing

## O que é phishing?
Phishing é uma técnica de engenharia social onde atacantes se fazem passar por organizações legítimas (Microsoft, seu banco, RH da empresa) para roubar credenciais ou instalar malware.

## Sinais de alerta — sempre verifique:

### 1. Remetente suspeito
- O endereço de e-mail real (não apenas o nome exibido) é do domínio correto?
- **Exemplo de golpe:** "Microsoft Support" \`<support@micros0ft-security.xyz>\`
- **Legítimo:** \`<support@microsoft.com>\`

### 2. Urgência artificial
- "Sua conta será bloqueada em 24 horas"
- "Ação imediata necessária"
- "Último aviso"
- Pressão para agir rápido sem pensar é sinal clássico de golpe.

### 3. Links suspeitos
- Passe o mouse sobre o link **sem clicar** e veja a URL real
- URLs legítimas da Microsoft: \`microsoft.com\`, \`live.com\`, \`office.com\`
- URLs suspeitas: \`microsoft-security-alert.tk\`, \`login-microsoft.xyz\`

### 4. Erros de português e formatação estranha
- E-mails corporativos legítimos passam por revisão
- Erros graves de gramática são um sinal de fraude

### 5. Pedido de credenciais por e-mail
- **Nenhuma empresa legítima pede sua senha por e-mail**
- Bancos, Microsoft e RH nunca solicitam senha por e-mail

## O que fazer quando receber um e-mail suspeito?

1. **Não clique em nenhum link**
2. **Não abra anexos**
3. **Reporte ao departamento de TI** (use o botão "Reportar como phishing" no Outlook)
4. **Delete o e-mail**

## Teste seus conhecimentos
Se você clicou em um link de teste de segurança (como o que acabou de chegar), isso é um exercício para melhorar sua proteção. Não há punições — o objetivo é aprendizado.`,
    isBuiltIn: true,
    videoUrl: null,
    quizQuestions: [
      {
        question: "Um e-mail do 'Suporte Microsoft' pede sua senha para liberar sua conta. O que você faz?",
        options: [
          "Respondo com minha senha para resolver logo",
          "Reporto ao TI e deleto o e-mail — nenhuma empresa pede senha por e-mail",
          "Encaminho para meu chefe antes de responder",
          "Clico no link para verificar se é real",
        ],
        correctIndex: 1,
      },
      {
        question: "Como verificar se um link em um e-mail é seguro antes de clicar?",
        options: [
          "Ver se o e-mail parece profissional",
          "Passar o mouse sobre o link e verificar a URL real que aparece na barra de status",
          "Verificar se o remetente tem foto de perfil",
          "Clicar rapidamente e ver se abre algo suspeito",
        ],
        correctIndex: 1,
      },
      {
        question: "Qual dos seguintes é um sinal claro de phishing?",
        options: [
          "E-mail com logo da empresa formatado corretamente",
          "E-mail enviado de support@microsoft.com",
          "E-mail criando urgência: 'Sua conta será bloqueada em 2 horas'",
          "E-mail com assinatura digital válida",
        ],
        correctIndex: 2,
      },
    ],
  },
  {
    title: "Senhas Fortes e Gestão de Credenciais",
    description: "Boas práticas para criar e gerenciar senhas seguras.",
    moduleType: "article",
    contentMarkdown: `# Senhas Fortes e Gestão de Credenciais

## Por que senhas fracas são perigosas?
Atacantes usam ferramentas automatizadas que testam milhões de combinações por segundo. Uma senha como "senha123" é quebrada em segundos.

## Características de uma senha forte

| Característica | Exemplo fraco | Exemplo forte |
|---|---|---|
| Comprimento | 6 caracteres | 16+ caracteres |
| Complexidade | "joao2023" | "J@0#Bk9$mNp2!qRv" |
| Unicidade | Mesma em tudo | Uma por serviço |
| Aleatoriedade | Nome + data | Gerada por gerenciador |

## Regra de ouro: use um gerenciador de senhas

- **Bitwarden** (gratuito, open source)
- **1Password** (pago, corporativo)
- **KeePass** (local, gratuito)

O gerenciador gera e lembra senhas únicas e longas para cada serviço.

## Autenticação Multifator (MFA) — sempre que disponível

MFA adiciona uma segunda camada: mesmo que sua senha seja roubada, o atacante não consegue entrar sem o código do seu celular.

1. Ative MFA no Microsoft 365
2. Ative MFA no Google
3. Ative MFA em qualquer sistema que ofereça

## O que NUNCA fazer

- Não reutilizar senhas entre serviços
- Não anotar senhas em papéis ou arquivos .txt
- Não compartilhar senhas por e-mail, WhatsApp ou Teams
- Não usar dados pessoais: nome, data de nascimento, CPF`,
    isBuiltIn: true,
    videoUrl: null,
    quizQuestions: [
      {
        question: "Qual é a melhor maneira de gerenciar senhas únicas para muitos serviços?",
        options: [
          "Usar a mesma senha forte em todos os lugares",
          "Anotar as senhas em um caderno seguro",
          "Usar um gerenciador de senhas confiável",
          "Usar variações da mesma senha (ex: Senha1!, Senha2!)",
        ],
        correctIndex: 2,
      },
      {
        question: "O que é Autenticação Multifator (MFA)?",
        options: [
          "Usar duas senhas diferentes no mesmo sistema",
          "Um segundo fator de verificação (código SMS/app) além da senha",
          "Um sistema que troca sua senha automaticamente",
          "Verificação por impressão digital apenas",
        ],
        correctIndex: 1,
      },
    ],
  },
  {
    title: "Spoofing e Engenharia Social",
    description: "Entenda como atacantes falsificam identidades e como se defender.",
    moduleType: "article",
    contentMarkdown: `# Spoofing e Engenharia Social

## O que é spoofing de e-mail?
Spoofing é quando um atacante envia e-mails como se fossem do seu domínio ou de um domínio confiável, sem ter acesso real àquele sistema.

**Exemplo:** Um e-mail que parece vir de \`ceo@suaempresa.com.br\` mas foi enviado por um servidor malicioso.

## Como o spoofing funciona?

O protocolo SMTP (e-mail) foi criado nos anos 80 sem autenticação. Por padrão, qualquer servidor pode enviar e-mail "de" qualquer endereço.

As proteções modernas (SPF, DKIM, DMARC) bloqueiam isso quando configuradas corretamente.

## Técnicas comuns de engenharia social

### BEC (Business Email Compromise)
- Atacante compromete ou imita conta do CEO/CFO
- Envia pedido urgente de transferência financeira
- **Proteção:** Verificar transferências financeiras por ligação/presencialmente

### Vishing (phishing por voz)
- Ligação fingindo ser suporte de TI, banco ou governo
- Pede credenciais, acesso remoto ou dados pessoais
- **Proteção:** Desligar e ligar de volta para o número oficial

### Pretexting
- Atacante cria uma história convincente ("sou do RH, precisamos verificar...")
- Cria urgência ou autoridade para obter informações
- **Proteção:** Verificar identidade antes de fornecer qualquer dado

## Bandeiras vermelhas em ligações suspeitas

- Pedido de acesso remoto ao computador
- Pedido de código de autenticação (MFA)
- Pressão para agir agora sem verificar
- Ameaça de consequências (conta bloqueada, multa, demissão)`,
    isBuiltIn: true,
    videoUrl: null,
    quizQuestions: [
      {
        question: "Você recebe uma ligação do 'suporte de TI' pedindo o código que chegou no seu celular. O que faz?",
        options: [
          "Forneço o código — TI precisa para me ajudar",
          "Desligo e ligo de volta pelo número oficial do TI para confirmar",
          "Espero ele explicar melhor antes de decidir",
          "Peço o nome do técnico e forneço o código",
        ],
        correctIndex: 1,
      },
      {
        question: "O CEO envia um e-mail urgente pedindo transferência de R$50.000 para um novo fornecedor. O que você faz?",
        options: [
          "Realizo a transferência — é o CEO",
          "Respondo o e-mail pedindo mais detalhes",
          "Ligo ou vou pessoalmente até o CEO para confirmar antes de qualquer ação financeira",
          "Encaminho para o financeiro sem verificar",
        ],
        correctIndex: 2,
      },
    ],
  },
];

// ─── Routes ──────────────────────────────────────────────────────────────────

router.get("/awareness/modules", requireAuth, async (req, res): Promise<void> => {
  const custom = await db
    .select()
    .from(awarenessModulesTable)
    .orderBy(awarenessModulesTable.createdAt);

  const hasBuiltins = custom.some((m) => m.isBuiltIn);

  if (!hasBuiltins) {
    // Seed built-in modules
    await db
      .insert(awarenessModulesTable)
      .values(BUILTIN_MODULES)
      .onConflictDoNothing();
  }

  const all = hasBuiltins
    ? custom
    : await db
        .select()
        .from(awarenessModulesTable)
        .orderBy(awarenessModulesTable.createdAt);

  res.json(all);
});

router.get("/awareness/modules/:moduleId", requireAuth, async (req, res): Promise<void> => {
  const [module] = await db
    .select()
    .from(awarenessModulesTable)
    .where(eq(awarenessModulesTable.id, req.params.moduleId as string))
    .limit(1);
  if (!module) {
    res.status(404).json({ error: "Módulo não encontrado" });
    return;
  }
  res.json(module);
});

router.post("/awareness/modules", requireAuth, async (req, res): Promise<void> => {
  const parsed = z
    .object({
      title: z.string().min(1),
      description: z.string().min(1),
      contentMarkdown: z.string().min(1),
      moduleType: z.enum(["article", "video", "quiz"]).default("article"),
      videoUrl: z.string().url().optional(),
      quizQuestions: z
        .array(
          z.object({
            question: z.string(),
            options: z.array(z.string()).min(2),
            correctIndex: z.number().int().min(0),
          }),
        )
        .optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [created] = await db
    .insert(awarenessModulesTable)
    .values({ ...parsed.data, isBuiltIn: false })
    .returning();
  res.status(201).json(created);
});

router.patch("/awareness/modules/:moduleId", requireAuth, async (req, res): Promise<void> => {
  const parsed = z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      contentMarkdown: z.string().optional(),
      videoUrl: z.string().url().optional(),
      quizQuestions: z.array(z.any()).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [updated] = await db
    .update(awarenessModulesTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(
      and(
        eq(awarenessModulesTable.id, req.params.moduleId as string),
        eq(awarenessModulesTable.isBuiltIn, false),
      ),
    )
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Módulo não encontrado ou é built-in" });
    return;
  }
  res.json(updated);
});

router.delete("/awareness/modules/:moduleId", requireAuth, async (req, res): Promise<void> => {
  const [deleted] = await db
    .delete(awarenessModulesTable)
    .where(
      and(
        eq(awarenessModulesTable.id, req.params.moduleId as string),
        eq(awarenessModulesTable.isBuiltIn, false),
      ),
    )
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Módulo não encontrado ou é built-in" });
    return;
  }
  res.sendStatus(204);
});

// Completions
router.post(
  "/awareness/modules/:moduleId/complete",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = z
      .object({ employeeId: z.string().uuid(), score: z.number().int().min(0).max(100).optional() })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [created] = await db
      .insert(awarenessCompletionsTable)
      .values({
        moduleId: req.params.moduleId as string,
        employeeId: parsed.data.employeeId,
        score: parsed.data.score ?? null,
      })
      .returning();
    res.status(201).json(created);
  },
);

router.get(
  "/awareness/modules/:moduleId/completions",
  requireAuth,
  async (req, res): Promise<void> => {
    const completions = await db
      .select()
      .from(awarenessCompletionsTable)
      .where(eq(awarenessCompletionsTable.moduleId, req.params.moduleId as string))
      .orderBy(desc(awarenessCompletionsTable.completedAt));
    res.json(completions);
  },
);

export default router;
