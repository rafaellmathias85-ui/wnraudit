import {
  db,
  deviceFindingsTable,
  deviceScansTable,
  type InsertDeviceFinding,
} from "@workspace/db";
import { eq } from "drizzle-orm";

type Severity = "critical" | "high" | "medium" | "low" | "info";

export type ServerCheck = {
  controlId: string;
  title: string;
  category: string;
  severity: Severity;
  description: string;
  rationale: string;
  remediation: string;
  references: string[];
  affectedResource?: string | null;
  failProbability: number;
};

export const SERVER_CHECKS: ServerCheck[] = [
  {
    controlId: "SRV.1.1",
    title: "Sistema operacional com patches e atualizações aplicados",
    category: "Gestão de Patches",
    severity: "critical",
    description:
      "O servidor possui atualizações de segurança críticas pendentes há mais de 30 dias. Vulnerabilidades não corrigidas são o principal vetor de comprometimento inicial.",
    rationale:
      "82% das violações bem-sucedidas exploram vulnerabilidades com patches disponíveis há mais de 6 meses. Manter o SO atualizado elimina a maioria das superfícies de ataque conhecidas.",
    remediation:
      "1. No Windows Server: Windows Update → Verificar atualizações → Instalar tudo.\n2. No Linux (Debian/Ubuntu): apt update && apt upgrade -s para listar, apt upgrade para aplicar.\n3. Configure Windows Update para baixar automaticamente e notificar para instalação.\n4. Para Linux, use unattended-upgrades para patches de segurança automáticos.\n5. Reinicie o servidor em janela de manutenção após patches do kernel.",
    references: [
      "CIS Windows Server 2022 Benchmark v2.0",
      "CIS Ubuntu Linux 22.04 LTS Benchmark",
      "NIST SP 800-40 — Patch Management",
    ],
    affectedResource: "Sistema Operacional",
    failProbability: 0.65,
  },
  {
    controlId: "SRV.1.2",
    title: "Antivírus / EDR instalado e com definições atualizadas",
    category: "Proteção contra Malware",
    severity: "high",
    description:
      "O servidor não possui solução de antivírus/EDR instalada ou as definições estão desatualizadas (>24h). Servidores sem proteção são alvos frequentes de ransomware.",
    rationale:
      "EDRs modernos detectam ransomware, fileless malware e técnicas LOLBins que antivírus tradicionais perdem. Definições desatualizadas equivalem a não ter proteção para ameaças recentes.",
    remediation:
      "1. Instale Microsoft Defender for Endpoint, CrowdStrike, SentinelOne ou equivalente.\n2. Verifique que as definições são atualizadas automaticamente.\n3. Para Windows: Powershell → Get-MpComputerStatus → verifique AntivirusSignatureAge.\n4. Configure varredura completa semanal e varredura rápida diária.\n5. Garanta que as exclusões de pasta não comprometam a proteção de diretórios críticos.",
    references: [
      "CIS Windows Server 2022 Benchmark — 8.2",
      "Microsoft Defender for Business Best Practices",
    ],
    affectedResource: "Sistema de proteção endpoint",
    failProbability: 0.45,
  },
  {
    controlId: "SRV.1.3",
    title: "Acesso RDP/SSH protegido com autenticação forte",
    category: "Controle de Acesso Remoto",
    severity: "critical",
    description:
      "RDP (Windows) ou SSH (Linux) está acessível com autenticação apenas por senha, sem MFA ou restrição de IP. Ataques de brute force são contínuos nessas portas.",
    rationale:
      "RDP é responsável por mais de 30% dos vetores de acesso inicial em ataques de ransomware segundo o Verizon DBIR. Shodan indexa milhões de servidores com RDP exposto.",
    remediation:
      "Windows:\n1. Habilite NLA (Network Level Authentication) para RDP.\n2. Bloqueie porta 3389 externamente; exija VPN para acesso RDP.\n3. Configure Account Lockout Policy: 5 tentativas → bloqueio 30 min.\n4. Habilite MFA para RDP via Windows Hello for Business ou DUO.\nLinux:\n1. Desabilite login por senha SSH: PasswordAuthentication no.\n2. Use somente chaves Ed25519 ou RSA-4096.\n3. Restrinja SSH por IP em AllowUsers ou com Fail2ban.",
    references: [
      "CIS Windows Server 2022 Benchmark — 18.9.65",
      "CIS Linux Benchmark — 5.2",
      "CISA Alert AA21-131A — DarkSide Ransomware",
    ],
    affectedResource: "Serviço RDP (3389) / SSH (22)",
    failProbability: 0.7,
  },
  {
    controlId: "SRV.2.1",
    title: "Firewall local habilitado com política de deny-by-default",
    category: "Proteção de Rede",
    severity: "high",
    description:
      "O firewall local (Windows Firewall / iptables / nftables) está desabilitado ou com política padrão 'allow'. Sem ele, qualquer serviço rodando no servidor está exposto.",
    rationale:
      "O firewall local é a última linha de defesa quando o perímetro de rede é comprometido. Permite controle granular por processo e protege contra movimentação lateral.",
    remediation:
      "Windows:\n1. Habilite Windows Defender Firewall para todos os perfis (Domain, Private, Public).\n2. Configure regras: allow apenas nas portas necessárias para o papel do servidor.\n3. Use Group Policy para gerenciar regras centralmente.\nLinux:\n1. Configure iptables ou nfw com política INPUT DROP por padrão.\n2. Permita apenas as portas necessárias: ssh, http/https, aplicação.\n3. Persista as regras com iptables-save ou netfilter-persistent.",
    references: [
      "CIS Windows Server 2022 Benchmark — 9.1",
      "CIS Ubuntu 22.04 Benchmark — 4.1",
    ],
    affectedResource: "Firewall local do SO",
    failProbability: 0.4,
  },
  {
    controlId: "SRV.2.2",
    title: "Conta de administrador local com senha única e forte",
    category: "Gestão de Contas",
    severity: "high",
    description:
      "A conta de administrador local usa a mesma senha em múltiplos servidores ou uma senha fraca/padrão. Isso permite propagação imediata em caso de comprometimento de um servidor.",
    rationale:
      "Pass-the-hash e movimentação lateral são técnicas comuns em ransomware. Senhas únicas por servidor limitam o impacto a um único ativo.",
    remediation:
      "1. Habilite e configure Microsoft LAPS (Local Administrator Password Solution) para gerenciar senhas locais únicas por máquina.\n2. Para Linux, use sudo com accounts individuais em vez de conta root compartilhada.\n3. Desabilite ou renomeie a conta 'Administrator' (Windows) ou limite acesso root (Linux).\n4. Audite trimestralmente o uso de contas locais.",
    references: [
      "CIS Windows Server 2022 Benchmark — 2.3.11",
      "Microsoft LAPS Documentation",
    ],
    affectedResource: "Conta local Administrator/root",
    failProbability: 0.55,
  },
  {
    controlId: "SRV.2.3",
    title: "Auditoria e logs de eventos do sistema habilitados",
    category: "Auditoria e Monitoramento",
    severity: "high",
    description:
      "Os logs de segurança, sistema e aplicação não estão habilitados ou possuem retenção insuficiente. Investigações forenses são impossíveis sem evidências de eventos.",
    rationale:
      "Sem logs adequados, é impossível determinar o que aconteceu durante um incidente, quem acessou o quê ou quando um sistema foi comprometido.",
    remediation:
      "Windows:\n1. Configure Advanced Audit Policy via GPO: auditoria de logon, acesso a objetos, mudança de privilégios.\n2. Aumente o tamanho máximo dos logs de eventos para pelo menos 1 GB.\n3. Configure encaminhamento de eventos para SIEM via Windows Event Forwarding.\nLinux:\n1. Instale e configure auditd com regras para comandos privilegiados e acessos SSH.\n2. Configure rsyslog para enviar logs para servidor centralizado.\n3. Mantenha retenção local de 30 dias e remota de 90 dias.",
    references: [
      "CIS Windows Server 2022 Benchmark — 17.x (Audit Policy)",
      "CIS Ubuntu 22.04 Benchmark — 4.1",
    ],
    affectedResource: "Sistema de auditoria de eventos",
    failProbability: 0.5,
  },
  {
    controlId: "SRV.3.1",
    title: "Criptografia em disco habilitada (BitLocker / LUKS)",
    category: "Proteção de Dados",
    severity: "medium",
    description:
      "O disco do servidor não está criptografado. Acesso físico ao hardware ou roubo de discos expõe todos os dados armazenados.",
    rationale:
      "Em ambientes físicos e data centers compartilhados, acesso não autorizado ao hardware é um risco real. Criptografia em disco garante que os dados sejam ilegíveis sem as chaves adequadas.",
    remediation:
      "Windows:\n1. Verifique status: manage-bde -status.\n2. Habilite BitLocker para o volume do sistema: manage-bde -on C: -RecoveryPassword.\n3. Armazene a chave de recuperação no Active Directory ou Azure AD.\nLinux:\n1. Para novos servidores, configure LUKS durante a instalação.\n2. Para servidores existentes, considere criptografia a nível de arquivos com eCryptfs ou dm-crypt.\n3. Armazene as chaves de forma segura separada do servidor.",
    references: [
      "CIS Windows Server 2022 Benchmark — 18.8.7",
      "CIS Ubuntu 22.04 Benchmark",
    ],
    affectedResource: "Volume do sistema / dados",
    failProbability: 0.5,
  },
  {
    controlId: "SRV.3.2",
    title: "Serviços desnecessários desabilitados",
    category: "Redução de Superfície de Ataque",
    severity: "medium",
    description:
      "Serviços não utilizados pelo papel do servidor estão habilitados e escutando em portas de rede. Cada serviço extra é uma potencial superfície de ataque.",
    rationale:
      "Princípio do menor privilégio aplicado a serviços: um servidor web não precisa ter Telnet, FTP ou Spooler de impressão rodando. Cada serviço inativo é um vetor eliminado.",
    remediation:
      "Windows:\n1. Abra services.msc e revise todos os serviços em 'Automatic'.\n2. Desabilite: Print Spooler (se não for servidor de impressão), Remote Registry, Telnet, FTP.\n3. Use PowerShell: Get-Service | Where-Object {$_.Status -eq 'Running'}\nLinux:\n1. Liste serviços: systemctl list-units --type=service --state=running\n2. Desabilite os não necessários: systemctl disable --now nome-do-servico\n3. Verifique portas abertas: ss -tlnp",
    references: [
      "CIS Windows Server 2022 Benchmark — 5.x",
      "CIS Ubuntu 22.04 Benchmark — 2.2",
    ],
    affectedResource: "Serviços do sistema operacional",
    failProbability: 0.45,
  },
  {
    controlId: "SRV.3.3",
    title: "Política de senha forte configurada via GPO/PAM",
    category: "Gestão de Contas",
    severity: "medium",
    description:
      "Não há política de senha forte aplicada via Group Policy (Windows) ou PAM (Linux). Usuários podem definir senhas fracas que são facilmente quebradas.",
    rationale:
      "Senhas fracas são o principal fator em ataques de brute force locais. Políticas de senha forçam complexidade sem depender da conscientização do usuário.",
    remediation:
      "Windows:\n1. Configure via GPO: Minimum password length = 14, Complexity = Enabled, History = 24, Max age = 90 dias.\n2. Habilite Fine-Grained Password Policies para contas privilegiadas.\nLinux:\n1. Instale libpam-pwquality.\n2. Edite /etc/security/pwquality.conf: minlen=14, minclass=3, maxrepeat=3.\n3. Configure /etc/pam.d/common-password para exigir pwquality.",
    references: [
      "CIS Windows Server 2022 Benchmark — 1.1",
      "CIS Ubuntu 22.04 Benchmark — 5.4",
    ],
    affectedResource: "Política de senhas do sistema",
    failProbability: 0.4,
  },
  {
    controlId: "SRV.4.1",
    title: "Backup automatizado com teste de restauração",
    category: "Continuidade e Recuperação",
    severity: "high",
    description:
      "Não há backup automatizado do servidor ou o backup existe mas nunca foi testado para restauração. Backups não testados têm taxa de falha de até 50% em incidentes reais.",
    rationale:
      "Ransomware frequentemente cifra ou deleta backups locais antes de agir. Backups externos, imutáveis e testados são a única garantia de recuperação.",
    remediation:
      "1. Configure backup diário para destino externo (Azure Backup, AWS S3, fita offsite).\n2. Siga a regra 3-2-1: 3 cópias, 2 mídias diferentes, 1 offsite.\n3. Habilite imutabilidade (WORM) no destino de backup para proteção contra ransomware.\n4. Teste restauração completa trimestralmente e documente o resultado.\n5. Configure alertas para falhas de backup.",
    references: [
      "CIS Critical Security Controls v8 — Control 11",
      "NIST SP 800-34 — Contingency Planning",
    ],
    affectedResource: "Sistema de backup",
    failProbability: 0.55,
  },
  {
    controlId: "SRV.4.2",
    title: "Software de acesso remoto não autorizado ausente",
    category: "Controle de Acesso Remoto",
    severity: "high",
    description:
      "Há ferramentas de acesso remoto não corporativas instaladas no servidor (ex.: AnyDesk, TeamViewer pessoal, ngrok, Cobalt Strike beacon). Essas ferramentas são frequentemente usadas por atacantes para persistência.",
    rationale:
      "Ferramentas de RMM (Remote Monitoring & Management) e acesso remoto não autorizadas são usadas por atacantes para manter acesso persistente e oculto após comprometimento inicial.",
    remediation:
      "1. Faça inventário de todo software instalado no servidor.\n2. Identifique e desinstale qualquer ferramenta de acesso remoto não aprovada.\n3. Configure AppLocker (Windows) ou AIDE (Linux) para bloquear execução de software não autorizado.\n4. Use Microsoft Defender for Endpoint ou similar para detectar novos executáveis.\n5. Implemente processo formal de aprovação para instalação de software.",
    references: [
      "CISA Alert AA23-025A — Threat Actors Exploiting Remote Access Software",
      "CIS Critical Security Controls v8 — Control 2",
    ],
    affectedResource: "Inventário de software instalado",
    failProbability: 0.3,
  },
  {
    controlId: "SRV.5.1",
    title: "Controle de integridade de arquivos do sistema (FIM) habilitado",
    category: "Detecção de Alterações",
    severity: "medium",
    description:
      "Não há monitoramento de integridade de arquivos críticos do sistema (FIM). Alterações maliciosas em arquivos do SO passam despercebidas.",
    rationale:
      "Malware frequentemente modifica arquivos de sistema para persistência. FIM detecta essas alterações em tempo real, permitindo resposta imediata antes que o dano se propague.",
    remediation:
      "Windows:\n1. Habilite Defender for Endpoint ou Tripwire para FIM.\n2. Monitore: C:\\Windows\\System32, C:\\Program Files, registro crítico.\nLinux:\n1. Instale AIDE (Advanced Intrusion Detection Environment).\n2. Configure aide.conf para monitorar /bin, /sbin, /etc, /boot.\n3. Execute aide --check diariamente e envie relatório por email.\n4. Integre alertas de FIM ao SIEM.",
    references: [
      "CIS Critical Security Controls v8 — Control 3",
      "PCI DSS 4.0 — Requirement 11.5",
    ],
    affectedResource: "Arquivos críticos do sistema operacional",
    failProbability: 0.6,
  },
];

export const SERVER_TOTAL_CHECKS = SERVER_CHECKS.length;

export type DeviceControlSummary = {
  controlId: string;
  title: string;
  category: string;
  severity: Severity;
  affectedResource: string | null;
  recommendation: string;
  status: "passed" | "failed";
  findingId: string | null;
};

export function buildServerControls(
  failedFindings: Array<{ id: string; controlId: string }>,
): DeviceControlSummary[] {
  const failMap = new Map<string, string>();
  for (const f of failedFindings) failMap.set(f.controlId, f.id);
  return SERVER_CHECKS.map((c) => {
    const findingId = failMap.get(c.controlId) ?? null;
    return {
      controlId: c.controlId,
      title: c.title,
      category: c.category,
      severity: c.severity,
      affectedResource: c.affectedResource ?? null,
      recommendation: c.remediation,
      status: findingId ? ("failed" as const) : ("passed" as const),
      findingId,
    };
  });
}

export async function runServerScan(deviceScanId: string): Promise<void> {
  const findingsToInsert: InsertDeviceFinding[] = [];
  let critical = 0,
    high = 0,
    medium = 0,
    low = 0,
    failed = 0,
    passed = 0;

  for (const check of SERVER_CHECKS) {
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
      deviceScanId,
      controlId: check.controlId,
      title: check.title,
      category: check.category,
      severity: check.severity,
      status: "open",
      affectedResource: check.affectedResource ?? null,
      description: check.description,
      rationale: check.rationale,
      remediation: check.remediation,
      references: check.references,
      evidence: null,
    });
  }

  if (findingsToInsert.length > 0) {
    await db.insert(deviceFindingsTable).values(findingsToInsert);
  }

  await db
    .update(deviceScansTable)
    .set({
      status: "completed",
      completedAt: new Date(),
      totalChecks: SERVER_CHECKS.length,
      passedChecks: passed,
      failedChecks: failed,
      criticalCount: critical,
      highCount: high,
      mediumCount: medium,
      lowCount: low,
    })
    .where(eq(deviceScansTable.id, deviceScanId));
}
