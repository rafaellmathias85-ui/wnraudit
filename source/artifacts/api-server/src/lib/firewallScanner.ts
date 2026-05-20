import {
  db,
  deviceFindingsTable,
  deviceScansTable,
  type InsertDeviceFinding,
} from "@workspace/db";
import { eq } from "drizzle-orm";

type Severity = "critical" | "high" | "medium" | "low" | "info";

export type FirewallCheck = {
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

export const FIREWALL_CHECKS: FirewallCheck[] = [
  {
    controlId: "FW.1.1",
    title: "Credencial padrão de administrador alterada",
    category: "Controle de Acesso",
    severity: "critical",
    description:
      "O firewall ainda utiliza usuário e/ou senha de fábrica (ex.: admin/admin). Qualquer atacante com acesso à rede pode comprometer o dispositivo imediatamente.",
    rationale:
      "Credenciais padrão são amplamente documentadas e as primeiras testadas em ataques automatizados. Um firewall comprometido expõe toda a rede.",
    remediation:
      "1. Acesse o painel de administração do firewall.\n2. Altere o usuário padrão para um nome único e não óbvio.\n3. Defina uma senha mínima de 16 caracteres com letras, números e símbolos.\n4. Desabilite o usuário 'admin' ou 'root' padrão se o fabricante permitir.\n5. Habilite MFA para acesso administrativo remoto.",
    references: [
      "CIS Benchmark — Network Devices",
      "NIST SP 800-41 — Guidelines on Firewalls",
    ],
    affectedResource: "Interface de administração",
    failProbability: 0.55,
  },
  {
    controlId: "FW.1.2",
    title: "Firmware atualizado na versão mais recente",
    category: "Gestão de Patches",
    severity: "high",
    description:
      "O firmware do firewall está desatualizado. Versões antigas frequentemente possuem vulnerabilidades CVE conhecidas e exploráveis remotamente.",
    rationale:
      "CVEs críticos em firewalls (ex.: FortiOS CVE-2022-40684, SonicWall SSLVPN) são ativamente explorados. Manter firmware atualizado elimina a maioria das vulnerabilidades pré-autenticação.",
    remediation:
      "1. Verifique a versão atual: Painel → Sistema → Sobre/Firmware.\n2. Consulte o portal do fabricante para a versão estável mais recente.\n3. Faça backup da configuração antes de atualizar.\n4. Aplique a atualização em janela de manutenção.\n5. Configure alertas automáticos de novas releases do fabricante.",
    references: [
      "CIS Benchmark — Network Devices",
      "CISA Known Exploited Vulnerabilities Catalog",
    ],
    affectedResource: "Firmware do dispositivo",
    failProbability: 0.65,
  },
  {
    controlId: "FW.1.3",
    title: "Interface de administração inacessível pela WAN",
    category: "Exposição da Superfície de Ataque",
    severity: "critical",
    description:
      "A interface web ou SSH de gerenciamento está acessível a partir da internet (WAN). Isso expõe o firewall a ataques de força bruta e exploits públicos.",
    rationale:
      "Interfaces de gerenciamento expostas à internet são alvos constantes de scanners automáticos (Shodan, Censys). Em 2023, mais de 50% das violações de rede envolveram gerenciamento remoto exposto.",
    remediation:
      "1. Bloqueie acesso à porta 443, 8443 e 22 vindo da WAN nas próprias regras do firewall.\n2. Restrinja gerenciamento remoto apenas à interface LAN ou VLAN de management.\n3. Se acesso remoto for necessário, use VPN como pré-requisito.\n4. Habilite 'Management Interface' apenas na interface interna.",
    references: [
      "CIS Benchmark — Network Devices 1.2",
      "NIST SP 800-41",
    ],
    affectedResource: "Interface WAN — porta administrativa",
    failProbability: 0.45,
  },
  {
    controlId: "FW.1.4",
    title: "HTTPS obrigatório para acesso ao painel (HTTP desabilitado)",
    category: "Criptografia em Trânsito",
    severity: "high",
    description:
      "O painel de administração aceita conexões HTTP sem criptografia. Credenciais e sessões podem ser interceptadas em ataques man-in-the-middle.",
    rationale:
      "HTTP transmite credenciais em texto claro. Em redes locais com VLAN compartilhada ou WiFi, ataques de ARP spoofing permitem captura trivial de sessões administrativas.",
    remediation:
      "1. Desabilite o protocolo HTTP nas configurações do painel administrativo.\n2. Habilite apenas HTTPS com TLS 1.2+ e cipher suites fortes.\n3. Configure redirecionamento automático HTTP → HTTPS se necessário.\n4. Renove o certificado TLS antes do vencimento e use certificado confiável.",
    references: [
      "CIS Benchmark — Network Devices",
    ],
    affectedResource: "Interface de gerenciamento web",
    failProbability: 0.4,
  },
  {
    controlId: "FW.2.1",
    title: "Regras de firewall revisadas e sem regras 'any-to-any'",
    category: "Política de Firewall",
    severity: "high",
    description:
      "Existem regras permissivas 'allow any any' ou regras abertas demais que permitem tráfego irrestrito entre segmentos de rede.",
    rationale:
      "Regras excessivamente permissivas comprometem a segmentação de rede, permitindo que um atacante que comprometa um segmento se mova lateralmente para toda a rede.",
    remediation:
      "1. Revise todas as regras e identifique as com 'any' como origem ou destino.\n2. Substitua por regras específicas: IP de origem, destino e porta.\n3. Implemente política de 'default deny' — bloqueie todo tráfego não explicitamente permitido.\n4. Documente o propósito de cada regra com um comentário.\n5. Realize revisão trimestral das regras.",
    references: [
      "CIS Benchmark — Network Devices 2.1",
      "NIST SP 800-41 rev 1",
    ],
    affectedResource: "Política de regras (ruleset)",
    failProbability: 0.6,
  },
  {
    controlId: "FW.2.2",
    title: "Logging de eventos habilitado e enviado para SIEM/Syslog",
    category: "Auditoria e Monitoramento",
    severity: "high",
    description:
      "O firewall não está enviando logs para um servidor centralizado (Syslog/SIEM). Eventos de segurança não são retidos para investigação forense.",
    rationale:
      "Sem logs centralizados, é impossível detectar varreduras de porta, tentativas de brute force, conexões suspeitas ou investigar incidentes após o fato.",
    remediation:
      "1. Configure o servidor Syslog ou SIEM nas configurações de logging do firewall.\n2. Habilite logging de: conexões negadas, tentativas de login, alterações de configuração.\n3. Defina retenção mínima de 90 dias nos logs.\n4. Configure alertas para eventos críticos: múltiplas falhas de autenticação, alterações de regras.",
    references: [
      "CIS Benchmark — Network Devices 2.3",
      "ISO 27001 — A.12.4",
    ],
    affectedResource: "Sistema de logging",
    failProbability: 0.55,
  },
  {
    controlId: "FW.2.3",
    title: "Segmentação de rede com VLANs implementada",
    category: "Segmentação de Rede",
    severity: "medium",
    description:
      "A rede não possui segmentação adequada por VLANs. Servidores, estações de trabalho, IoT e rede de visitantes compartilham o mesmo segmento.",
    rationale:
      "Sem VLANs, um dispositivo comprometido tem acesso irrestrito a toda a rede. A segmentação limita o raio de impacto de um incidente e dificulta a movimentação lateral.",
    remediation:
      "1. Identifique os segmentos: Servidores, Usuários, IoT, Visitantes, Management.\n2. Crie VLANs correspondentes no firewall e switches.\n3. Aplique regras de inter-VLAN específicas — apenas o tráfego necessário deve cruzar VLANs.\n4. Coloque dispositivos IoT e visitantes em VLANs isoladas sem acesso à LAN corporativa.",
    references: [
      "CIS Benchmark — Network Devices 3.1",
      "NIST SP 800-41",
    ],
    affectedResource: "Topologia de rede",
    failProbability: 0.5,
  },
  {
    controlId: "FW.3.1",
    title: "VPN configurada com autenticação multifator",
    category: "Acesso Remoto",
    severity: "high",
    description:
      "A VPN utiliza apenas usuário/senha para autenticação. Credenciais VPN são frequentemente alvo de phishing e credential stuffing.",
    rationale:
      "VPNs sem MFA são o principal vetor de acesso inicial documentado pela CISA e Mandiant nos últimos anos. A adição de um segundo fator bloqueia a grande maioria desses ataques.",
    remediation:
      "1. Configure autenticação RADIUS/LDAP com segundo fator (TOTP, push notification).\n2. Integre o firewall com o provedor de MFA (Duo, Microsoft Entra, Google Authenticator).\n3. Configure timeout de sessão VPN de no máximo 8 horas com re-autenticação.\n4. Habilite split-tunneling apenas se estritamente necessário.",
    references: [
      "CISA Alert AA22-074A — Default Credentials Used in Ransomware",
      "CIS Benchmark — Network Devices 4.1",
    ],
    affectedResource: "VPN Gateway",
    failProbability: 0.6,
  },
  {
    controlId: "FW.3.2",
    title: "NTP configurado com fonte confiável",
    category: "Integridade de Tempo",
    severity: "low",
    description:
      "O firewall não possui NTP configurado ou usa uma fonte NTP não confiável. Timestamps incorretos comprometem correlação de logs e validade de certificados.",
    rationale:
      "Logs com horário errado inviabilizam investigações forenses. Além disso, desvios de tempo podem invalidar handshakes TLS e certificados digitais.",
    remediation:
      "1. Configure pelo menos 2 servidores NTP confiáveis (pool.ntp.org ou NTP interno).\n2. Verifique a sincronização: hora do firewall deve bater com a hora real.\n3. Habilite autenticação NTP (NTPv4 com MD5/SHA1) se suportado.\n4. Configure alerta para desvio de tempo maior que 1 minuto.",
    references: [
      "CIS Benchmark — Network Devices 5.1",
    ],
    affectedResource: "Configuração de NTP",
    failProbability: 0.35,
  },
  {
    controlId: "FW.3.3",
    title: "Backup automático da configuração habilitado",
    category: "Continuidade e Recuperação",
    severity: "medium",
    description:
      "Não há backup automático da configuração do firewall. Uma falha de hardware ou misconfiguration pode resultar em perda total da configuração e interrupção prolongada.",
    rationale:
      "Sem backup, uma substituição de hardware ou erro de configuração pode levar horas ou dias para restaurar. Backups automáticos garantem RTO reduzido.",
    remediation:
      "1. Configure export automático da configuração (diário ou após cada mudança).\n2. Armazene backups em servidor remoto (SFTP, S3 ou repositório de configs).\n3. Teste restauração a partir do backup pelo menos trimestralmente.\n4. Versione os backups — mantenha pelo menos 30 dias de histórico.",
    references: [
      "CIS Benchmark — Network Devices 6.1",
      "ISO 27001 — A.12.3",
    ],
    affectedResource: "Sistema de backup de configuração",
    failProbability: 0.5,
  },
  {
    controlId: "FW.4.1",
    title: "Inspeção SSL/TLS (HTTPS Inspection) configurada",
    category: "Inspeção de Tráfego",
    severity: "medium",
    description:
      "A inspeção de tráfego HTTPS (SSL Inspection) não está habilitada. Malware e exfiltração de dados podem ocorrer em canais cifrados sem detecção.",
    rationale:
      "Mais de 80% do tráfego malicioso hoje usa HTTPS. Sem inspeção SSL, firewalls e sistemas de detecção ficam cegos ao conteúdo cifrado, incluindo C2 de ransomware.",
    remediation:
      "1. Habilite SSL/TLS Inspection nas configurações de segurança do firewall.\n2. Configure uma CA interna e distribua o certificado raiz às estações.\n3. Exclua sites bancários e de saúde da inspeção para privacidade.\n4. Monitore os relatórios de SSL Inspection para identificar tráfego malicioso.",
    references: [
      "NIST SP 800-41",
      "CIS Benchmark — Network Devices",
    ],
    affectedResource: "Motor de inspeção de conteúdo",
    failProbability: 0.55,
  },
  {
    controlId: "FW.4.2",
    title: "IPS/IDS habilitado com assinaturas atualizadas",
    category: "Prevenção de Intrusão",
    severity: "high",
    description:
      "O sistema de prevenção de intrusão (IPS) está desabilitado ou com assinaturas desatualizadas. Exploits conhecidos passam pela rede sem bloqueio.",
    rationale:
      "IPS com assinaturas atualizadas bloqueia exploits de vulnerabilidades conhecidas automaticamente, mesmo antes de os sistemas internos serem atualizados.",
    remediation:
      "1. Habilite o módulo IPS/IDS nas configurações de segurança.\n2. Configure atualização automática das assinaturas (pelo menos diária).\n3. Inicie em modo 'detect only' por 7 dias para validar falsos positivos.\n4. Ative o bloqueio automático para categorias críticas (exploits, botnets, C2).\n5. Revise alertas IPS semanalmente.",
    references: [
      "CIS Benchmark — Network Devices",
      "NIST SP 800-94 — IDS/IPS Guide",
    ],
    affectedResource: "Módulo IPS/IDS",
    failProbability: 0.5,
  },
];

export const FIREWALL_TOTAL_CHECKS = FIREWALL_CHECKS.length;

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

export function buildFirewallControls(
  failedFindings: Array<{ id: string; controlId: string }>,
): DeviceControlSummary[] {
  const failMap = new Map<string, string>();
  for (const f of failedFindings) failMap.set(f.controlId, f.id);
  return FIREWALL_CHECKS.map((c) => {
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

export async function runFirewallScan(deviceScanId: string): Promise<void> {
  const findingsToInsert: InsertDeviceFinding[] = [];
  let critical = 0,
    high = 0,
    medium = 0,
    low = 0,
    failed = 0,
    passed = 0;

  for (const check of FIREWALL_CHECKS) {
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
      totalChecks: FIREWALL_CHECKS.length,
      passedChecks: passed,
      failedChecks: failed,
      criticalCount: critical,
      highCount: high,
      mediumCount: medium,
      lowCount: low,
    })
    .where(eq(deviceScansTable.id, deviceScanId));
}
