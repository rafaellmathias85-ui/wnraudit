import { db, findingsTable, scansTable, type InsertFinding } from "@workspace/db";
import { eq } from "drizzle-orm";

type Severity = "critical" | "high" | "medium" | "low" | "info";

export type ScanCheck = {
  controlId: string;
  title: string;
  category: string;
  severity: Severity;
  description: string;
  rationale: string;
  remediation: string;
  configPath: string;
  references: string[];
  affectedResource?: string | null;
  evidence?: Record<string, unknown> | null;
  /** Probability the check fails (0..1). Used to simulate findings on first scan. */
  failProbability: number;
};

export const CIS_CHECKS: ScanCheck[] = [
  {
    controlId: "1.1.1",
    title: "Garantir que MFA esteja habilitado para todos os usuários",
    category: "Identidade e Acesso",
    severity: "critical",
    description:
      "Existem contas de usuário no tenant sem autenticação multifator (MFA) habilitada. O MFA é a defesa mais eficaz contra comprometimento de conta.",
    rationale:
      "A Microsoft reporta que o MFA bloqueia mais de 99,9% dos ataques de comprometimento de identidade. Contas administrativas ou usuárias sem MFA representam o vetor de ataque mais comum em ambientes Microsoft 365.",
    remediation:
      "1. Acesse o Microsoft Entra admin center → Proteção → Métodos de autenticação.\n2. Crie ou ative uma política de Conditional Access exigindo MFA para todos os usuários.\n3. Para administradores, ative a baseline 'Require multi-factor authentication for admins'.\n4. Comunique os usuários sobre o registro do método (Microsoft Authenticator recomendado).\n5. Monitore o relatório de uso de MFA semanalmente.",
    configPath: "Microsoft Entra Admin Center → Proteção → Acesso Condicional → Políticas → Nova Política",
    references: [
      "CIS Microsoft 365 Foundations Benchmark v3.0.0 — 1.1.1",
      "https://learn.microsoft.com/entra/identity/authentication/concept-mfa-howitworks",
      "https://entra.microsoft.com/#view/Microsoft_AAD_ConditionalAccess/ConditionalAccessBlade/~/Policies",
    ],
    affectedResource: "Diretório do tenant",
    failProbability: 0.85,
  },
  {
    controlId: "1.1.3",
    title: "Bloquear protocolos de autenticação legados",
    category: "Identidade e Acesso",
    severity: "high",
    description:
      "Os protocolos de autenticação legados (POP, IMAP, SMTP AUTH, ActiveSync básico) ainda estão habilitados no tenant. Esses protocolos não suportam MFA e são alvo frequente de password spray.",
    rationale:
      "Mais de 99% dos ataques de password spray e credential stuffing observados pela Microsoft usam autenticação legada para contornar o MFA. Bloquear esses protocolos elimina a maior parte da superfície de ataque de força bruta.",
    remediation:
      "1. Em Entra ID → Conditional Access, crie uma política 'Block legacy authentication'.\n2. Aplique a todos os usuários, incluindo serviços (com exceções somente quando justificadas).\n3. Audite usuários impactados via 'Sign-in logs' filtrando por Client App = Other clients.\n4. Comunique a mudança e migre clientes legados para Modern Auth.",
    configPath: "Microsoft Entra Admin Center → Proteção → Acesso Condicional → Políticas → Nova Política → Aplicativos de cliente: Outros clientes",
    references: [
      "CIS Microsoft 365 Foundations Benchmark v3.0.0 — 1.1.3",
      "https://learn.microsoft.com/entra/identity/conditional-access/howto-conditional-access-policy-block-legacy",
      "https://entra.microsoft.com/#view/Microsoft_AAD_ConditionalAccess/ConditionalAccessBlade/~/Policies",
    ],
    affectedResource: "Conditional Access — políticas",
    failProbability: 0.7,
  },
  {
    controlId: "1.2.1",
    title: "Limitar quantidade de Global Administrators",
    category: "Identidade e Acesso",
    severity: "high",
    description:
      "Existem mais de 4 contas com a função Global Administrator atribuída de forma permanente. Privilégios excessivos aumentam o impacto em caso de comprometimento.",
    rationale:
      "O CIS recomenda entre 2 e 4 Global Administrators dedicados (sem caixa de email pessoal) para garantir continuidade sem ampliar a superfície de ataque. Contas Global Admin devem usar Privileged Identity Management (PIM) com elevação just-in-time.",
    remediation:
      "1. Liste todos os Global Admins em Entra ID → Roles and administrators.\n2. Mantenha apenas 2 a 4 contas dedicadas (sem licenças produtivas).\n3. Configure PIM para que as demais elevem o acesso just-in-time, com aprovação e janela máxima de 4h.\n4. Habilite alertas de criação de novos Global Admins via Microsoft Sentinel ou Defender for Cloud Apps.",
    configPath: "Microsoft Entra Admin Center → Funções e administradores → Global Administrator",
    references: [
      "CIS Microsoft 365 Foundations Benchmark v3.0.0 — 1.2.1",
      "https://learn.microsoft.com/entra/id-governance/privileged-identity-management/pim-configure",
      "https://entra.microsoft.com/#view/Microsoft_AAD_IAM/RolesManagementMenuBlade/~/AllRoles",
    ],
    affectedResource: "Função: Global Administrator",
    failProbability: 0.55,
  },
  {
    controlId: "1.3.1",
    title: "Desabilitar contas de usuário inativas há mais de 90 dias",
    category: "Higiene de Identidade",
    severity: "medium",
    description:
      "Foram identificadas contas habilitadas que não fazem login há mais de 90 dias. Contas dormentes são alvos preferenciais de ataques porque raramente disparam alertas comportamentais.",
    rationale:
      "Contas inativas tendem a ter senhas antigas, sem MFA atualizado e sem proprietários acompanhando alertas. Desabilitá-las reduz a superfície de ataque sem impactar produtividade.",
    remediation:
      "1. Em Entra ID → Users → All users, exporte a lista filtrando por 'Last sign-in date' > 90 dias.\n2. Confirme com o RH/gestão se a conta deve ser desabilitada ou removida.\n3. Desabilite (não exclua imediatamente) e mova para uma OU/grupo 'Inactive' por 30 dias antes da remoção.\n4. Automatize com Microsoft Graph + Logic Apps para revisões trimestrais.",
    configPath: "Microsoft Entra Admin Center → Usuários → Todos os usuários → Filtrar: Último login",
    references: [
      "CIS Microsoft 365 Foundations Benchmark v3.0.0 — 1.3.1",
      "https://entra.microsoft.com/#view/Microsoft_AAD_UsersAndTenants/UserManagementMenuBlade/~/AllUsers",
    ],
    affectedResource: "Diretório — usuários",
    failProbability: 0.6,
  },
  {
    controlId: "2.1.1",
    title: "Garantir Safe Links habilitado para Office aplicativos",
    category: "Defender for Office 365",
    severity: "high",
    description:
      "A política de Safe Links do Microsoft Defender for Office 365 não está aplicada para todos os aplicativos do Office (Teams, Word, Excel, PowerPoint).",
    rationale:
      "Safe Links reescreve URLs no momento do clique para validar destinos contra a inteligência de ameaças da Microsoft. Sem ele, links maliciosos enviados via Teams ou colados em documentos passam direto para o usuário.",
    remediation:
      "1. Acesse Microsoft Defender → Email & collaboration → Policies → Safe Links.\n2. Crie ou edite a política padrão para aplicar a todo o tenant.\n3. Habilite 'Apply Safe Links to email messages sent within the organization' e 'Office 365 apps'.\n4. Marque 'Do not let users click through to original URL'.\n5. Salve e verifique cobertura no painel de Threat Protection Status.",
    configPath: "Microsoft Defender Portal → Email e colaboração → Políticas e regras → Políticas de ameaças → Safe Links",
    references: [
      "CIS Microsoft 365 Foundations Benchmark v3.0.0 — 2.1.1",
      "https://learn.microsoft.com/defender-office-365/safe-links-about",
      "https://security.microsoft.com/safelinksv2",
    ],
    affectedResource: "Defender for Office 365 — Safe Links policy",
    failProbability: 0.5,
  },
  {
    controlId: "2.1.4",
    title: "Habilitar Safe Attachments para SharePoint, OneDrive e Teams",
    category: "Defender for Office 365",
    severity: "medium",
    description:
      "Safe Attachments para SharePoint/OneDrive/Teams está desabilitado. Arquivos maliciosos podem ser carregados e propagados internamente sem detonação em sandbox.",
    rationale:
      "Esse controle remove arquivos identificados como maliciosos após upload e antes que sejam abertos por outros usuários, contendo a propagação de ransomware via colaboração.",
    remediation:
      "1. Em Microsoft Defender → Email & collaboration → Policies → Safe Attachments.\n2. Habilite 'Turn on Defender for Office 365 for SharePoint, OneDrive, and Microsoft Teams'.\n3. Verifique a quarentena para entender o impacto operacional antes de aplicar a toda a base.",
    configPath: "Microsoft Defender Portal → Email e colaboração → Políticas e regras → Políticas de ameaças → Safe Attachments",
    references: [
      "CIS Microsoft 365 Foundations Benchmark v3.0.0 — 2.1.4",
      "https://security.microsoft.com/safeattachmentv2",
    ],
    affectedResource: "Defender — Safe Attachments para SharePoint/OneDrive",
    failProbability: 0.45,
  },
  {
    controlId: "3.1.1",
    title: "Habilitar logs de auditoria unificados",
    category: "Auditoria e Logging",
    severity: "high",
    description:
      "O Unified Audit Log do Microsoft 365 não está habilitado ou está parcialmente desabilitado em algumas cargas de trabalho.",
    rationale:
      "Sem logs unificados, investigações forenses ficam cegas. Atacantes frequentemente desabilitam auditoria como passo pós-comprometimento. CIS exige retenção mínima de 90 dias e idealmente 365 dias.",
    remediation:
      "1. Acesse Microsoft Purview → Audit.\n2. Clique em 'Start recording user and admin activity'.\n3. Confirme que Exchange, SharePoint, OneDrive, Teams e Entra estão sendo logados.\n4. Considere licenças E5 ou Audit (Premium) para retenção estendida.",
    configPath: "Microsoft Purview → Auditoria → Busca de auditoria → Iniciar gravação de atividades",
    references: [
      "CIS Microsoft 365 Foundations Benchmark v3.0.0 — 3.1.1",
      "https://learn.microsoft.com/purview/audit-log-enable-disable",
      "https://compliance.microsoft.com/auditlogsearch",
    ],
    affectedResource: "Microsoft Purview — Unified Audit",
    failProbability: 0.4,
  },
  {
    controlId: "5.1.1",
    title: "Bloquear consentimento de usuário a aplicações de terceiros",
    category: "Aplicações e Consentimento",
    severity: "high",
    description:
      "Usuários finais ainda podem conceder consentimento a aplicações OAuth de terceiros. Isso abre caminho para ataques de illicit consent grant.",
    rationale:
      "Atacantes registram aplicativos maliciosos e enganam usuários para concederem permissões sobre Mail.Read ou Files.Read.All, contornando o MFA e o login. O CIS recomenda exigir aprovação do administrador.",
    remediation:
      "1. Em Entra ID → Enterprise applications → Consent and permissions → User consent settings.\n2. Selecione 'Do not allow user consent' (ou permitir somente para apps verificados de baixo risco).\n3. Habilite o admin consent workflow para que usuários possam solicitar aprovação.\n4. Audite consents existentes em 'Permissions granted' nas últimas 90 dias.",
    configPath: "Microsoft Entra Admin Center → Aplicativos → Aplicativos empresariais → Consentimento e permissões → Configurações de consentimento do usuário",
    references: [
      "CIS Microsoft 365 Foundations Benchmark v3.0.0 — 5.1.1",
      "https://entra.microsoft.com/#view/Microsoft_AAD_IAM/ConsentPoliciesMenuBlade/~/UserSettings",
    ],
    affectedResource: "Entra ID — User consent settings",
    failProbability: 0.5,
  },
  {
    controlId: "6.2.1",
    title: "Restringir compartilhamento externo no SharePoint e OneDrive",
    category: "Colaboração e Compartilhamento",
    severity: "medium",
    description:
      "O nível de compartilhamento externo está em 'Anyone with the link', permitindo links anônimos para arquivos corporativos.",
    rationale:
      "Links anônimos podem ser indexados, compartilhados acidentalmente ou interceptados. CIS recomenda 'New and existing guests' como default, exigindo autenticação.",
    remediation:
      "1. Em SharePoint admin center → Policies → Sharing.\n2. Defina 'External sharing' como 'New and existing guests'.\n3. Para OneDrive, configure o mesmo nível ou inferior.\n4. Habilite 'Allow only users in specific security groups to share externally' quando aplicável.",
    configPath: "SharePoint Admin Center → Políticas → Compartilhamento",
    references: [
      "CIS Microsoft 365 Foundations Benchmark v3.0.0 — 6.2.1",
      "https://go.microsoft.com/fwlink/?linkid=2185219",
    ],
    affectedResource: "SharePoint Online — Sharing settings",
    failProbability: 0.55,
  },
  {
    controlId: "7.1.1",
    title: "Habilitar Conditional Access para acesso a dispositivos não conformes",
    category: "Dispositivos e Conformidade",
    severity: "medium",
    description:
      "Não existe política de Conditional Access bloqueando acesso a partir de dispositivos não conformes ou não gerenciados pelo Intune.",
    rationale:
      "Dispositivos pessoais (BYOD) sem proteções básicas (criptografia, antivírus, atualizações) podem ser usados para exfiltrar dados corporativos. CA + Intune garante baseline mínima.",
    remediation:
      "1. Em Microsoft Intune → Devices → Compliance policies, defina baseline (criptografia, PIN, OS atualizado).\n2. Em Entra ID → Conditional Access, crie política 'Require compliant device' para acesso a Office 365.\n3. Aplique inicialmente em modo Report-only por 7 dias.\n4. Promova para Enabled após validar impacto.",
    configPath: "Microsoft Intune Admin Center → Dispositivos → Políticas de conformidade — e — Microsoft Entra Admin Center → Proteção → Acesso Condicional",
    references: [
      "CIS Microsoft 365 Foundations Benchmark v3.0.0 — 7.1.1",
      "https://intune.microsoft.com/#view/Microsoft_Intune_DeviceSettings/DevicesMenu/~/compliancePolicies",
    ],
    affectedResource: "Conditional Access + Intune compliance",
    failProbability: 0.5,
  },
  {
    controlId: "8.1.1",
    title: "Habilitar criptografia de mensagens (OME) para Exchange Online",
    category: "Proteção de Dados",
    severity: "low",
    description:
      "Office Message Encryption não está configurado. Emails sensíveis trafegam sem criptografia ponta-a-ponta opcional para destinatários externos.",
    rationale:
      "OME permite que usuários marquem emails como confidenciais e que destinatários externos acessem com autenticação. Reduz exposição em caso de vazamento de inbox.",
    remediation:
      "1. Verifique se o tenant tem licença adequada (E3+).\n2. Em Microsoft Purview → Information protection, habilite as etiquetas de criptografia.\n3. Configure regras de fluxo de email no Exchange para detectar PII e aplicar criptografia automaticamente.",
    configPath: "Microsoft Purview → Proteção de informações → Etiquetas de confidencialidade — e — Exchange Admin Center → Fluxo de emails → Regras",
    references: [
      "CIS Microsoft 365 Foundations Benchmark v3.0.0 — 8.1.1",
      "https://compliance.microsoft.com/informationprotection",
    ],
    affectedResource: "Exchange Online + Purview",
    failProbability: 0.3,
  },
  {
    controlId: "9.1.1",
    title: "Revisar políticas de retenção de dados",
    category: "Governança",
    severity: "info",
    description:
      "Não há política de retenção configurada para Teams, Exchange e SharePoint. Isso pode gerar perda de evidência em casos legais ou retenção indefinida desnecessária.",
    rationale:
      "Política de retenção formal demonstra conformidade com LGPD e similares, e evita custos de armazenamento desnecessários.",
    remediation:
      "1. Em Microsoft Purview → Data lifecycle management, crie políticas de retenção alinhadas ao plano de dados da organização.\n2. Documente o período (ex.: 7 anos para finanças, 1 ano para chats não-críticos).\n3. Comunique aos usuários e arquive a política no sistema de gestão.",
    configPath: "Microsoft Purview → Gerenciamento do ciclo de vida de dados → Políticas de retenção",
    references: [
      "CIS Microsoft 365 Foundations Benchmark v3.0.0 — 9.1.1",
      "https://compliance.microsoft.com/informationgovernance",
    ],
    affectedResource: "Purview — Retention policies",
    failProbability: 0.4,
  },
];

export const TOTAL_CHECKS = CIS_CHECKS.length;

export type ScanControlSummary = {
  controlId: string;
  title: string;
  category: string;
  severity: Severity;
  affectedResource: string | null;
  recommendation: string;
  configPath: string;
  status: "passed" | "failed";
  findingId: string | null;
};

export function buildControlsForScan(
  failedFindings: Array<{ id: string; controlId: string }>,
): ScanControlSummary[] {
  const failMap = new Map<string, string>();
  for (const f of failedFindings) failMap.set(f.controlId, f.id);

  return CIS_CHECKS.map((c) => {
    const findingId = failMap.get(c.controlId) ?? null;
    return {
      controlId: c.controlId,
      title: c.title,
      category: c.category,
      severity: c.severity,
      affectedResource: c.affectedResource ?? null,
      recommendation: c.remediation,
      configPath: c.configPath,
      status: findingId ? ("failed" as const) : ("passed" as const),
      findingId,
    };
  });
}

export async function runScanForTenant(scanId: string): Promise<void> {
  const findingsToInsert: InsertFinding[] = [];
  let critical = 0;
  let high = 0;
  let medium = 0;
  let low = 0;
  let failed = 0;
  let passed = 0;

  for (const check of CIS_CHECKS) {
    const fails = Math.random() < check.failProbability;
    if (!fails) {
      passed += 1;
      continue;
    }
    failed += 1;
    if (check.severity === "critical") critical += 1;
    else if (check.severity === "high") high += 1;
    else if (check.severity === "medium") medium += 1;
    else if (check.severity === "low") low += 1;

    findingsToInsert.push({
      scanId,
      controlId: check.controlId,
      title: check.title,
      category: check.category,
      severity: check.severity,
      status: "open",
      affectedResource: check.affectedResource ?? null,
      description: check.description,
      rationale: check.rationale,
      remediation: check.remediation,
      configPath: check.configPath,
      references: check.references,
      evidence: check.evidence ?? null,
    });
  }

  if (findingsToInsert.length > 0) {
    await db.insert(findingsTable).values(findingsToInsert);
  }

  await db
    .update(scansTable)
    .set({
      status: "completed",
      completedAt: new Date(),
      totalChecks: CIS_CHECKS.length,
      passedChecks: passed,
      failedChecks: failed,
      criticalCount: critical,
      highCount: high,
      mediumCount: medium,
      lowCount: low,
    })
    .where(eq(scansTable.id, scanId));
}
