import net from "node:net";
import tls from "node:tls";
import dns from "node:dns/promises";
import { and, eq } from "drizzle-orm";
import {
  db,
  deviceFindingsTable,
  deviceScansTable,
  externalAssetsTable,
  type InsertDeviceFinding,
} from "@workspace/db";
import { logger } from "./logger";

type Severity = "critical" | "high" | "medium" | "low" | "info";

const COMMON_PORTS: Array<{ port: number; service: string }> = [
  { port: 21, service: "FTP" },
  { port: 22, service: "SSH" },
  { port: 23, service: "Telnet" },
  { port: 25, service: "SMTP" },
  { port: 53, service: "DNS" },
  { port: 80, service: "HTTP" },
  { port: 110, service: "POP3" },
  { port: 111, service: "RPCBind" },
  { port: 135, service: "MS-RPC" },
  { port: 139, service: "NetBIOS" },
  { port: 143, service: "IMAP" },
  { port: 161, service: "SNMP" },
  { port: 389, service: "LDAP" },
  { port: 443, service: "HTTPS" },
  { port: 445, service: "SMB" },
  { port: 465, service: "SMTPS" },
  { port: 587, service: "SMTP-Sub" },
  { port: 636, service: "LDAPS" },
  { port: 993, service: "IMAPS" },
  { port: 995, service: "POP3S" },
  { port: 1433, service: "MSSQL" },
  { port: 1723, service: "PPTP" },
  { port: 2049, service: "NFS" },
  { port: 2222, service: "SSH-Alt" },
  { port: 3306, service: "MySQL" },
  { port: 3389, service: "RDP" },
  { port: 4443, service: "HTTPS-Alt" },
  { port: 4444, service: "Metasploit" },
  { port: 5432, service: "PostgreSQL" },
  { port: 5900, service: "VNC" },
  { port: 5985, service: "WinRM-HTTP" },
  { port: 5986, service: "WinRM-HTTPS" },
  { port: 6379, service: "Redis" },
  { port: 8000, service: "HTTP-Alt" },
  { port: 8008, service: "HTTP-Alt" },
  { port: 8080, service: "HTTP-Proxy" },
  { port: 8081, service: "HTTP-Alt" },
  { port: 8443, service: "HTTPS-Alt" },
  { port: 8888, service: "HTTP-Alt" },
  { port: 9000, service: "HTTP-Alt" },
  { port: 9090, service: "Prometheus" },
  { port: 9200, service: "Elasticsearch" },
  { port: 10000, service: "Webmin" },
  { port: 11211, service: "Memcached" },
  { port: 27017, service: "MongoDB" },
  { port: 50000, service: "SAP" },
];

const HIGH_RISK_EXPOSED_PORTS = new Set<number>([
  21, 23, 25, 110, 111, 135, 139, 143, 161, 389, 445, 1433, 1723, 2049, 3306,
  3389, 5432, 5900, 6379, 9200, 11211, 27017,
]);

const ENCRYPTED_PORTS = new Set<number>([
  443, 465, 636, 993, 995, 4443, 5986, 8443,
]);

const HTTP_PORTS = new Set<number>([80, 8000, 8008, 8080, 8081, 8888, 9000]);
const HTTPS_PORTS = new Set<number>([443, 4443, 8443]);

type Check = Omit<InsertDeviceFinding, "deviceScanId">;

function tcpConnect(
  host: string,
  port: number,
  timeoutMs = 3500,
): Promise<{ open: boolean; banner: string | null }> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let banner = "";
    let settled = false;
    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve({ open, banner: banner.trim() || null });
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => {
      // Wait briefly for banner from talkative services
      const bannerTimer = setTimeout(() => finish(true), 1000);
      sock.on("data", (chunk) => {
        banner += chunk.toString("utf8", 0, Math.min(chunk.length, 256));
        if (banner.length > 256) {
          clearTimeout(bannerTimer);
          finish(true);
        }
      });
    });
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
    sock.connect(port, host);
  });
}

type TlsInfo = {
  protocol: string | null;
  cipher: { name: string; version: string } | null;
  cert: {
    subject: string | null;
    issuer: string | null;
    validFrom: Date | null;
    validTo: Date | null;
    san: string[];
  } | null;
  selfSigned: boolean;
};

function tlsInspect(host: string, port: number): Promise<TlsInfo | null> {
  return new Promise((resolve) => {
    const sock = tls.connect(
      {
        host,
        port,
        servername: host,
        rejectUnauthorized: false,
        timeout: 5000,
      },
      () => {
        try {
          const cert = sock.getPeerCertificate(true);
          const cipher = sock.getCipher();
          const protocol = sock.getProtocol();
          const sanRaw = (cert?.subjectaltname as string | undefined) ?? "";
          const san = sanRaw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          const flatten = (v: unknown): string | null => {
            if (!v) return null;
            if (Array.isArray(v)) return v.length > 0 ? String(v[0]) : null;
            return String(v);
          };
          const subject = flatten(cert?.subject?.CN);
          const issuer = flatten(cert?.issuer?.CN);
          const validFrom = cert?.valid_from
            ? new Date(cert.valid_from)
            : null;
          const validTo = cert?.valid_to ? new Date(cert.valid_to) : null;
          const selfSigned = subject !== null && subject === issuer;
          sock.destroy();
          resolve({
            protocol: protocol ?? null,
            cipher: cipher
              ? { name: cipher.name, version: cipher.version }
              : null,
            cert:
              cert && Object.keys(cert).length > 0
                ? { subject, issuer, validFrom, validTo, san }
                : null,
            selfSigned,
          });
        } catch {
          sock.destroy();
          resolve(null);
        }
      },
    );
    sock.once("error", () => {
      sock.destroy();
      resolve(null);
    });
    sock.once("timeout", () => {
      sock.destroy();
      resolve(null);
    });
  });
}

async function fetchHeaders(
  host: string,
  port: number,
  https: boolean,
): Promise<Record<string, string> | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const url = `${https ? "https" : "http"}://${host}:${port}/`;
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return headers;
  } catch {
    return null;
  }
}

const SECURITY_HEADERS = [
  {
    key: "strict-transport-security",
    name: "HSTS (Strict-Transport-Security)",
    severity: "high" as Severity,
    remediation:
      "Adicione o cabeçalho Strict-Transport-Security ao servidor web com 'max-age=31536000; includeSubDomains; preload'.",
    rationale:
      "Sem HSTS, navegadores podem aceitar downgrade de HTTPS para HTTP, expondo a sessão a ataques de SSL stripping.",
  },
  {
    key: "content-security-policy",
    name: "Content-Security-Policy",
    severity: "medium" as Severity,
    remediation:
      "Defina uma política CSP mínima como \"default-src 'self'\" e refine conforme os recursos legítimos da aplicação.",
    rationale:
      "CSP é a defesa em profundidade primária contra XSS. Sem CSP, qualquer falha de injeção pode comprometer o navegador do usuário.",
  },
  {
    key: "x-frame-options",
    name: "X-Frame-Options",
    severity: "medium" as Severity,
    remediation: "Adicione X-Frame-Options: SAMEORIGIN (ou DENY) ao servidor web.",
    rationale:
      "Sem este cabeçalho a página pode ser embedada em iframes maliciosos (clickjacking).",
  },
  {
    key: "x-content-type-options",
    name: "X-Content-Type-Options",
    severity: "low" as Severity,
    remediation: "Adicione X-Content-Type-Options: nosniff.",
    rationale:
      "Sem este cabeçalho, navegadores podem fazer MIME sniffing, executando conteúdo malicioso entregue como texto.",
  },
  {
    key: "referrer-policy",
    name: "Referrer-Policy",
    severity: "low" as Severity,
    remediation:
      "Adicione Referrer-Policy: no-referrer-when-downgrade (ou strict-origin-when-cross-origin).",
    rationale:
      "Sem política de referer, URLs internas podem ser vazadas para terceiros via navegação.",
  },
];

type ServiceCveHint = {
  matcher: RegExp;
  cve: string;
  description: string;
  severity: Severity;
  remediation: string;
};

const SERVICE_CVE_HINTS: ServiceCveHint[] = [
  {
    matcher: /OpenSSH_([0-6]\.|7\.[0-3])/i,
    cve: "CVE-2018-15473",
    severity: "high",
    description:
      "OpenSSH em versão ≤7.3 é vulnerável a enumeração de usuários (CVE-2018-15473), permitindo distinguir contas existentes via timing.",
    remediation:
      "Atualize o OpenSSH para a versão mais recente do fornecedor da distribuição (>= 7.4 já mitiga; idealmente >= 8.x).",
  },
  {
    matcher: /Microsoft-IIS\/([1-7]\.|8\.0|8\.5)/i,
    cve: "Multiple",
    severity: "high",
    description:
      "Microsoft IIS em versão antiga (<= 8.5) acumula CVEs significativos. Versões anteriores ao IIS 10 não recebem mais correções de segurança.",
    remediation:
      "Migre para Windows Server 2016+ com IIS 10. Mantenha Windows Update ativo para receber patches mensais.",
  },
  {
    matcher: /Apache\/2\.[0-3]\./i,
    cve: "Multiple",
    severity: "high",
    description:
      "Apache HTTPD 2.0/2.2/2.3 está em fim de vida e acumula CVEs críticos sem correção upstream.",
    remediation:
      "Atualize para Apache HTTPD 2.4.x e mantenha o pacote da distribuição atualizado mensalmente.",
  },
  {
    matcher: /nginx\/(0\.|1\.[0-9]\.|1\.1[0-7]\.)/i,
    cve: "Multiple",
    severity: "medium",
    description:
      "nginx em versão <= 1.17.x está sem suporte. Vulnerabilidades novas não são corrigidas.",
    remediation:
      "Atualize para nginx 1.24+ (LTS) ou pelo menos a versão suportada pela distribuição.",
  },
  {
    matcher: /vsFTPd 2\.3\.4/i,
    cve: "CVE-2011-2523",
    severity: "critical",
    description:
      "vsFTPd 2.3.4 contém um backdoor (CVE-2011-2523) que abre um shell na porta 6200 quando solicitado um login com usuário terminado em ':)'.",
    remediation: "Remova vsFTPd 2.3.4 e instale vsFTPd 3.x do repositório oficial.",
  },
  {
    matcher: /Microsoft FTP Service/i,
    cve: "Hardening",
    severity: "high",
    description:
      "FTP transmite credenciais em texto claro. Em ambientes corporativos modernos não há motivo para deixar FTP acessível pela internet.",
    remediation:
      "Substitua FTP por SFTP (porta 22) ou FTPS com TLS obrigatório. Bloqueie a porta 21 na borda.",
  },
  {
    matcher: /Telnet/i,
    cve: "Hardening",
    severity: "critical",
    description:
      "Telnet transmite credenciais em texto claro e não possui proteção contra interceptação.",
    remediation: "Desabilite o serviço Telnet e use SSH (porta 22). Bloqueie a porta 23 na borda.",
  },
];

function buildExternalControls(
  results: ExternalScanResult,
): Array<{
  controlId: string;
  title: string;
  category: string;
  severity: Severity;
  affectedResource: string | null;
  recommendation: string;
  status: "passed" | "failed";
  findingId: string | null;
}> {
  const controls: Array<{
    controlId: string;
    title: string;
    category: string;
    severity: Severity;
    affectedResource: string | null;
    recommendation: string;
    status: "passed" | "failed";
    findingId: string | null;
  }> = [];

  for (const f of results.findings) {
    controls.push({
      controlId: f.controlId,
      title: f.title,
      category: f.category,
      severity: f.severity as Severity,
      affectedResource: f.affectedResource ?? null,
      recommendation: f.remediation,
      status: "failed",
      findingId: null,
    });
  }
  return controls;
}

export { buildExternalControls };

export type ExternalScanResult = {
  findings: Check[];
  totals: {
    total: number;
    passed: number;
    failed: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
};

function isIp(host: string): boolean {
  return net.isIP(host) > 0;
}

const DKIM_COMMON_SELECTORS = [
  "default",
  "google",
  "mail",
  "email",
  "k1",
  "k2",
  "s1",
  "s2",
  "dkim",
  "proofpoint",
  "selector1",
  "selector2",
  "smtp",
  "mta",
];

async function dkimCheck(host: string): Promise<Check | null> {
  for (const selector of DKIM_COMMON_SELECTORS) {
    try {
      const records = await dns
        .resolveTxt(`${selector}._domainkey.${host}`)
        .catch(() => [] as string[][]);
      const flat = records.map((r) => r.join(""));
      if (flat.some((r) => /v=DKIM1/i.test(r))) {
        return null;
      }
    } catch {
      // selector not found
    }
  }
  return {
    controlId: "EXT.DNS.DKIM",
    title: "Registro DKIM não encontrado em seletores comuns",
    category: "DNS / E-mail",
    severity: "medium",
    status: "open",
    affectedResource: `*._domainkey.${host}`,
    description:
      "Nenhum registro DKIM foi encontrado nos seletores mais comuns. Sem DKIM, e-mails enviados pelo domínio não possuem assinatura criptográfica.",
    rationale:
      "DKIM permite que servidores receptores verifiquem que o e-mail foi realmente enviado pelo domínio e não foi adulterado em trânsito. É exigido para políticas DMARC eficazes.",
    remediation:
      "1. Configure DKIM no seu servidor de e-mail (Google Workspace, Microsoft 365 ou Postfix).\n2. Publique o registro TXT no formato: [seletor]._domainkey.{domínio} com o valor v=DKIM1; k=rsa; p=...\n3. Valide a publicação com ferramenta como MXToolbox DKIM Lookup.",
    references: ["RFC 6376", "https://mxtoolbox.com/dkim.aspx"],
    evidence: { selectorsChecked: DKIM_COMMON_SELECTORS },
  };
}

async function mtaStsCheck(host: string): Promise<Check[]> {
  const findings: Check[] = [];
  try {
    const mtaStsRecords = await dns
      .resolveTxt(`_mta-sts.${host}`)
      .catch(() => [] as string[][]);
    const hasMtaSts = mtaStsRecords.map((r) => r.join("")).some((r) => /v=STSv1/i.test(r));
    if (!hasMtaSts) {
      findings.push({
        controlId: "EXT.DNS.MTASTS",
        title: "MTA-STS não configurado",
        category: "DNS / E-mail",
        severity: "low",
        status: "open",
        affectedResource: `_mta-sts.${host}`,
        description:
          "MTA-STS (Mail Transfer Agent Strict Transport Security) não está publicado. Sem ele, e-mails recebidos podem ser entregues sem criptografia TLS.",
        rationale:
          "MTA-STS instrui servidores de envio a entregar e-mails apenas via TLS, prevenindo ataques de downgrade durante a entrega SMTP.",
        remediation:
          "1. Crie um arquivo de política em https://mta-sts.{dominio}/.well-known/mta-sts.txt\n2. Publique o registro TXT _mta-sts.{dominio} com v=STSv1; id=...\n3. Verifique com MXToolbox MTA-STS Checker.",
        references: ["RFC 8461"],
        evidence: {},
      });
    }
  } catch {
    // not resolvable = not configured
    findings.push({
      controlId: "EXT.DNS.MTASTS",
      title: "MTA-STS não configurado",
      category: "DNS / E-mail",
      severity: "low",
      status: "open",
      affectedResource: `_mta-sts.${host}`,
      description: "MTA-STS não está publicado para o domínio.",
      rationale:
        "MTA-STS instrui servidores de envio a entregar e-mails apenas via TLS, prevenindo ataques de downgrade.",
      remediation:
        "Configure MTA-STS publicando um registro TXT em _mta-sts.{dominio} e hospedando a política em https://mta-sts.{dominio}/.well-known/mta-sts.txt",
      references: ["RFC 8461"],
      evidence: {},
    });
  }
  return findings;
}

const EXPOSED_PATHS = [
  { path: "/.env", title: "Arquivo .env exposto", severity: "critical" as Severity },
  { path: "/.git/HEAD", title: "Repositório .git exposto", severity: "critical" as Severity },
  { path: "/wp-admin/", title: "Painel WordPress exposto", severity: "high" as Severity },
  { path: "/wp-login.php", title: "Login WordPress exposto", severity: "high" as Severity },
  { path: "/admin/", title: "Painel /admin exposto", severity: "high" as Severity },
  { path: "/phpinfo.php", title: "phpinfo() exposto", severity: "high" as Severity },
  { path: "/.htpasswd", title: "Arquivo .htpasswd exposto", severity: "critical" as Severity },
  { path: "/config.php", title: "config.php exposto", severity: "high" as Severity },
  { path: "/backup.zip", title: "Backup .zip exposto na raiz", severity: "high" as Severity },
  { path: "/db.sql", title: "Dump de banco exposto", severity: "critical" as Severity },
  { path: "/server-status", title: "Apache server-status exposto", severity: "medium" as Severity },
  { path: "/actuator/health", title: "Spring Actuator exposto", severity: "medium" as Severity },
  { path: "/.DS_Store", title: "Artefato macOS .DS_Store exposto", severity: "low" as Severity },
];

async function exposedPathsCheck(
  host: string,
  port: number,
  isHttps: boolean,
): Promise<Check[]> {
  const findings: Check[] = [];
  const proto = isHttps ? "https" : "http";
  for (const ep of EXPOSED_PATHS) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const url = `${proto}://${host}:${port}${ep.path}`;
      const res = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (res.status === 200) {
        findings.push({
          controlId: `EXT.WEB.EXPOSED.${ep.path.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}`,
          title: ep.title,
          category: "Exposição de Arquivos Sensíveis",
          severity: ep.severity,
          status: "open",
          affectedResource: `${proto}://${host}:${port}${ep.path}`,
          description: `O recurso ${ep.path} retornou HTTP 200 e está publicamente acessível. Isso indica exposição de conteúdo sensível.`,
          rationale:
            "Arquivos de configuração, backups e repositórios expostos permitem que atacantes obtenham credenciais, chaves de API e estrutura interna da aplicação.",
          remediation:
            `1. Bloqueie o acesso ao caminho ${ep.path} via configuração do servidor web (nginx/Apache).\n2. Verifique se arquivos sensíveis existem no diretório web público e remova-os.\n3. Configure o servidor para negar requests a esse padrão com retorno 403 ou 404.`,
          references: ["OWASP Top 10 — A01: Broken Access Control"],
          evidence: { url, statusCode: res.status },
        });
      }
    } catch {
      // connection error or timeout = not exposed
    }
  }
  return findings;
}

async function corsCheck(
  host: string,
  port: number,
  isHttps: boolean,
): Promise<Check[]> {
  const findings: Check[] = [];
  try {
    const proto = isHttps ? "https" : "http";
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${proto}://${host}:${port}/`, {
      method: "GET",
      headers: { Origin: "https://evil.example.com" },
      redirect: "manual",
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const acao = res.headers.get("access-control-allow-origin");
    if (acao === "*" || acao === "https://evil.example.com") {
      findings.push({
        controlId: `EXT.WEB.CORS.${port}`,
        title: "CORS permissivo: todas origens permitidas",
        category: "Configuração de Segurança",
        severity: acao === "*" ? "high" : "medium",
        status: "open",
        affectedResource: `${proto}://${host}:${port}/`,
        description: `O servidor retornou Access-Control-Allow-Origin: ${acao}. Isso permite que qualquer site faça requisições autenticadas a esta API.`,
        rationale:
          "CORS excessivamente permissivo permite ataques de Cross-Site Request Forgery via origens maliciosas que conseguem ler respostas da API.",
        remediation:
          "1. Defina uma allowlist de origens legítimas em vez de usar *.\n2. Em Express: use cors({ origin: ['https://app.seudominio.com'] }).\n3. Nunca reflita a origem da requisição sem validação contra a allowlist.",
        references: ["OWASP CORS", "https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS"],
        evidence: { acao, testedOrigin: "https://evil.example.com" },
      });
    }
  } catch {
    // not accessible
  }
  return findings;
}

async function dnsChecks(host: string): Promise<Check[]> {
  const findings: Check[] = [];
  if (isIp(host)) return findings;
  try {
    const txts = await dns.resolveTxt(host).catch(() => [] as string[][]);
    const flat = txts.map((t) => t.join(""));
    const hasSpf = flat.some((t) => /^v=spf1/i.test(t));
    if (!hasSpf) {
      findings.push({
        controlId: "EXT.DNS.SPF",
        title: "Registro SPF ausente",
        category: "DNS / E-mail",
        severity: "medium",
        status: "open",
        affectedResource: `${host} (TXT)`,
        description:
          "Não foi encontrado registro SPF (v=spf1) para o domínio. Sem SPF, qualquer servidor pode falsificar e-mails em nome do seu domínio.",
        rationale:
          "SPF é uma das três pernas do DMARC. Sem ele, o domínio é facilmente usado em campanhas de phishing contra clientes e parceiros.",
        remediation:
          "1. Identifique todos os servidores que enviam e-mail pelo seu domínio.\n2. Crie um registro TXT: v=spf1 include:_spf.google.com -all (ajuste para o seu provedor).\n3. Termine com -all (reject) ou ~all (softfail). Evite +all.\n4. Valide com MXToolbox SPF Checker.",
        references: ["RFC 7208", "https://mxtoolbox.com/spf.aspx"],
        evidence: { txtRecords: flat },
      });
    }
    const dmarcRaw = await dns
      .resolveTxt(`_dmarc.${host}`)
      .catch(() => [] as string[][]);
    const dmarcFlat = dmarcRaw.map((t) => t.join(""));
    const hasDmarc = dmarcFlat.some((t) => /^v=DMARC1/i.test(t));
    if (!hasDmarc) {
      findings.push({
        controlId: "EXT.DNS.DMARC",
        title: "Registro DMARC ausente",
        category: "DNS / E-mail",
        severity: "high",
        status: "open",
        affectedResource: `_dmarc.${host}`,
        description:
          "O domínio não publica registro DMARC. Mensagens forjadas em nome do domínio passam sem ação dos servidores receptores.",
        rationale:
          "DMARC instrui provedores receptores (Gmail, Outlook) a rejeitar ou colocar em quarentena e-mails que falharem em SPF/DKIM. Sem DMARC, ataques de spoofing chegam à caixa de entrada.",
        remediation:
          "1. Crie um registro TXT em _dmarc.{dominio}.\n2. Valor mínimo: v=DMARC1; p=quarantine; rua=mailto:dmarc@{dominio}\n3. Monitore os relatórios por 2-4 semanas.\n4. Após validar que o tráfego legítimo está alinhado, evolua para p=reject.",
        references: ["RFC 7489", "https://mxtoolbox.com/dmarc.aspx"],
        evidence: { dmarcRecords: dmarcFlat },
      });
    } else {
      const policy = dmarcFlat
        .find((t) => /^v=DMARC1/i.test(t))
        ?.match(/p=(\w+)/i)?.[1]
        ?.toLowerCase();
      if (policy === "none") {
        findings.push({
          controlId: "EXT.DNS.DMARC.WEAK",
          title: "DMARC configurado em modo permissivo (p=none)",
          category: "DNS / E-mail",
          severity: "medium",
          status: "open",
          affectedResource: `_dmarc.${host}`,
          description:
            "DMARC está publicado mas a política é 'none', que apenas monitora e não rejeita e-mails forjados.",
          rationale:
            "Política 'none' não bloqueia spoofing — apenas gera relatórios. Atacantes continuam capazes de falsificar o domínio.",
          remediation:
            "1. Verifique os relatórios DMARC (rua) para identificar fontes legítimas que ainda não estão alinhadas.\n2. Corrija SPF e DKIM para essas fontes.\n3. Mude p=none para p=quarantine.\n4. Após 30 dias de observação sem falsos positivos, mude para p=reject.",
          references: ["RFC 7489"],
          evidence: { dmarcRecords: dmarcFlat },
        });
      }
    }

    // DKIM check
    const dkimFinding = await dkimCheck(host);
    if (dkimFinding) findings.push(dkimFinding);

    // MTA-STS check
    const mtaFindings = await mtaStsCheck(host);
    findings.push(...mtaFindings);
  } catch (err) {
    logger.warn({ err, host }, "DNS checks failed");
  }
  return findings;
}

type PortScanResult = { findings: Check[]; open: boolean; banner: string | null };

async function scanPort(
  host: string,
  port: number,
  service: string,
): Promise<PortScanResult> {
  const found: Check[] = [];
  const r = await tcpConnect(host, port);
  if (!r.open) return { findings: [], open: false, banner: null };

  // Open port itself
  if (HIGH_RISK_EXPOSED_PORTS.has(port)) {
    found.push({
      controlId: `EXT.PORT.${port}`,
      title: `Porta de alto risco exposta (${port}/${service})`,
      category: "Exposição de Superfície",
      severity:
        port === 23 || port === 445 || port === 3389 || port === 6379
          ? "critical"
          : "high",
      status: "open",
      affectedResource: `${host}:${port}`,
      description: `O serviço ${service} (porta ${port}) está respondendo na internet pública. Esse tipo de serviço quase nunca deveria estar exposto.`,
      rationale:
        "Serviços como SMB, RDP, MSSQL, MongoDB e Redis sem autenticação adequada (ou com qualquer autenticação) são alvos diários de scanners e ransomware. Exposição direta na WAN aumenta drasticamente o risco de comprometimento.",
      remediation: `1. Bloqueie a porta ${port} na borda (firewall/Edge).\n2. Se o acesso remoto for necessário, exija VPN com MFA antes de chegar nesse serviço.\n3. Se o serviço deve permanecer público, restrinja por ACL de IP de origem e habilite registro detalhado de acesso.`,
      references: ["CISA — Reducing Attack Surface", "NIST SP 800-41"],
      evidence: { port, service, banner: r.banner },
    });
  } else {
    found.push({
      controlId: `EXT.PORT.OPEN.${port}`,
      title: `Porta aberta detectada: ${port}/${service}`,
      category: "Inventário de Superfície",
      severity: "info",
      status: "open",
      affectedResource: `${host}:${port}`,
      description: `Porta ${port} (${service}) está aberta. Verifique se a exposição é intencional.`,
      rationale:
        "Toda porta aberta é uma superfície de ataque potencial. Documente a justificativa de cada exposição.",
      remediation:
        "Confirme se o serviço deve mesmo estar público. Se não, bloqueie a porta. Se sim, mantenha o software atualizado e monitorado.",
      references: [],
      evidence: { port, service, banner: r.banner },
    });
  }

  // Banner-based CVE matching
  if (r.banner) {
    for (const hint of SERVICE_CVE_HINTS) {
      if (hint.matcher.test(r.banner)) {
        found.push({
          controlId: `EXT.CVE.${hint.cve}.${port}`,
          title: `Versão potencialmente vulnerável: ${r.banner.split(/\s+/)[0]}`,
          category: "Vulnerabilidades Conhecidas (CVE)",
          severity: hint.severity,
          status: "open",
          affectedResource: `${host}:${port}`,
          description: hint.description,
          rationale:
            "Versões antigas de serviços expostos são exploradas em massa. A correlação banner→CVE indica fortemente um alvo fácil para atacantes automatizados.",
          remediation: hint.remediation,
          references: [
            hint.cve.startsWith("CVE")
              ? `https://nvd.nist.gov/vuln/detail/${hint.cve}`
              : "https://www.cve.org/",
          ],
          evidence: { banner: r.banner, port, cveHint: hint.cve },
        });
      }
    }
  }

  // TLS analysis on encrypted ports
  if (ENCRYPTED_PORTS.has(port) || HTTPS_PORTS.has(port)) {
    const t = await tlsInspect(host, port);
    if (t) {
      // Weak protocol
      if (
        t.protocol &&
        (t.protocol === "TLSv1" ||
          t.protocol === "TLSv1.1" ||
          t.protocol === "SSLv3")
      ) {
        found.push({
          controlId: `EXT.TLS.PROTO.${port}`,
          title: `Protocolo TLS depreciado em uso: ${t.protocol}`,
          category: "Criptografia em Trânsito",
          severity: "high",
          status: "open",
          affectedResource: `${host}:${port}`,
          description: `O serviço aceita conexões com ${t.protocol}, que é considerado obsoleto e inseguro pela indústria.`,
          rationale:
            "TLS 1.0 e 1.1 possuem ataques conhecidos (BEAST, POODLE) e foram depreciados pela IETF (RFC 8996). PCI-DSS proíbe seu uso.",
          remediation:
            "1. Desabilite TLS 1.0 e TLS 1.1 no servidor.\n2. Habilite apenas TLS 1.2 e TLS 1.3.\n3. Em servidores web (nginx/Apache/IIS), explicitamente liste 'ssl_protocols TLSv1.2 TLSv1.3'.",
          references: ["RFC 8996", "PCI-DSS 4.0 Requirement 4.2.1"],
          evidence: { protocol: t.protocol, cipher: t.cipher },
        });
      }
      // Cert validity
      if (t.cert?.validTo) {
        const days =
          (t.cert.validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
        if (days < 0) {
          found.push({
            controlId: `EXT.TLS.CERT.EXPIRED.${port}`,
            title: "Certificado TLS expirado",
            category: "Criptografia em Trânsito",
            severity: "critical",
            status: "open",
            affectedResource: `${host}:${port}`,
            description: `O certificado expirou em ${t.cert.validTo.toISOString()}.`,
            rationale:
              "Certificados expirados causam alertas de segurança nos navegadores e quebram comunicação com APIs e clientes corporativos.",
            remediation:
              "Renove o certificado imediatamente (ex.: Let's Encrypt com renovação automática via certbot).",
            references: [],
            evidence: { validTo: t.cert.validTo.toISOString() },
          });
        } else if (days < 14) {
          found.push({
            controlId: `EXT.TLS.CERT.EXPIRING.${port}`,
            title: `Certificado TLS expira em ${Math.floor(days)} dias`,
            category: "Criptografia em Trânsito",
            severity: "high",
            status: "open",
            affectedResource: `${host}:${port}`,
            description: `O certificado expira em ${t.cert.validTo.toISOString()}.`,
            rationale:
              "Certificado próximo de expirar pode causar indisponibilidade não planejada se a renovação automática falhar.",
            remediation:
              "Configure renovação automática (Let's Encrypt) e alerta de monitoramento para certificados com menos de 30 dias.",
            references: [],
            evidence: { validTo: t.cert.validTo.toISOString() },
          });
        }
      }
      if (t.selfSigned) {
        found.push({
          controlId: `EXT.TLS.SELFSIGNED.${port}`,
          title: "Certificado auto-assinado em uso",
          category: "Criptografia em Trânsito",
          severity: "medium",
          status: "open",
          affectedResource: `${host}:${port}`,
          description: "O certificado TLS é auto-assinado.",
          rationale:
            "Certificados auto-assinados não são confiáveis por navegadores nem por clientes corporativos, podendo mascarar ataques de man-in-the-middle.",
          remediation:
            "Substitua por certificado emitido por uma CA pública (Let's Encrypt é gratuito) ou pela CA interna corporativa.",
          references: [],
          evidence: {
            issuer: t.cert?.issuer ?? null,
            subject: t.cert?.subject ?? null,
          },
        });
      }
    }
  }

  // HTTP header checks
  if (HTTP_PORTS.has(port) || HTTPS_PORTS.has(port)) {
    const isHttps = HTTPS_PORTS.has(port);
    const headers = await fetchHeaders(host, port, isHttps);
    if (headers) {
      // HTTP on plain port: must redirect to HTTPS or be marked
      if (!isHttps && port === 80) {
        const loc = headers["location"];
        if (!loc || !loc.startsWith("https://")) {
          found.push({
            controlId: `EXT.HTTP.NOREDIRECT.${port}`,
            title: "HTTP não redireciona para HTTPS",
            category: "Criptografia em Trânsito",
            severity: "high",
            status: "open",
            affectedResource: `${host}:${port}/`,
            description:
              "O servidor HTTP responde diretamente em texto claro, sem forçar redirecionamento para HTTPS.",
            rationale:
              "Sem redirecionamento HTTPS, as primeiras requisições dos usuários trafegam em texto claro, expondo cookies e credenciais em redes hostis.",
            remediation:
              "Configure o servidor web para responder com 301/308 redirect para a versão HTTPS de toda URL na porta 80.",
            references: [],
            evidence: { headers },
          });
        }
      }
      // Security headers
      for (const sh of SECURITY_HEADERS) {
        if (!headers[sh.key]) {
          found.push({
            controlId: `EXT.HEADER.${sh.key.toUpperCase()}.${port}`,
            title: `Cabeçalho de segurança ausente: ${sh.name}`,
            category: "Cabeçalhos HTTP",
            severity: sh.severity,
            status: "open",
            affectedResource: `${host}:${port}/`,
            description: `O servidor não retorna o cabeçalho ${sh.name}.`,
            rationale: sh.rationale,
            remediation: sh.remediation,
            references: ["OWASP Secure Headers Project"],
            evidence: { receivedHeaders: Object.keys(headers) },
          });
        }
      }
      // Server banner exposed
      if (headers["server"]) {
        const v = headers["server"];
        if (/\d/.test(v)) {
          found.push({
            controlId: `EXT.HEADER.SERVERLEAK.${port}`,
            title: "Cabeçalho Server expõe versão do software",
            category: "Information Disclosure",
            severity: "low",
            status: "open",
            affectedResource: `${host}:${port}/`,
            description: `O cabeçalho Server expõe: "${v}".`,
            rationale:
              "Expor versão exata do servidor facilita o trabalho de scanners automatizados que procuram CVEs específicos para aquela versão.",
            remediation:
              "Configure o servidor web para suprimir ou ofuscar o cabeçalho Server (em nginx: server_tokens off; em Apache: ServerTokens Prod).",
            references: [],
            evidence: { server: v },
          });
        }
      }
    }
  }

  return { findings: found, open: true, banner: r.banner };
}

// ── Active Pentest Checks ─────────────────────────────────────────────────

const SQLI_TEST_PARAMS = ["id", "q", "search", "name", "user", "page", "item", "category"];

const SQLI_ERROR_PATTERNS = [
  /you have an error in your sql syntax/i,
  /warning:\s*mysql/i,
  /unclosed quotation mark after/i,
  /quoted string not properly terminated/i,
  /pg_query\(\)/i,
  /ora-\d{4,}/i,
  /microsoft ole db.*sql server/i,
  /odbc drivers error/i,
  /mysql_fetch_array/i,
  /sqlite_error/i,
  /jdbc\s+error/i,
  /syntax error.*near\s+['"]/i,
  /supplied argument is not a valid mysql/i,
  /unexpected end of sql command/i,
  /invalid query.*near/i,
];

async function checkSQLi(host: string, port: number, https: boolean): Promise<Check[]> {
  const proto = https ? "https" : "http";
  const baseUrl = `${proto}://${host}:${port}`;

  let baselineStatus = 0;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${baseUrl}/`, { method: "GET", redirect: "manual", signal: ctrl.signal });
    clearTimeout(t);
    baselineStatus = res.status;
  } catch {
    return [];
  }
  if (![200, 301, 302, 403, 401].includes(baselineStatus)) return [];

  for (const param of SQLI_TEST_PARAMS) {
    for (const payload of ["'", "\"", "' OR '1'='1'--"]) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        const url = `${baseUrl}/?${param}=${encodeURIComponent(payload)}`;
        const res = await fetch(url, {
          method: "GET",
          redirect: "manual",
          signal: ctrl.signal,
          headers: { "User-Agent": "Mozilla/5.0 (compatible; SecurityScanner/1.0)" },
        });
        clearTimeout(t);
        const body = await res.text().catch(() => "");
        const matched = SQLI_ERROR_PATTERNS.find((p) => p.test(body));
        if (matched) {
          return [{
            controlId: `EXT.WEB.SQLI.${port}`,
            title: "SQL Injection confirmado — erro de banco de dados exposto",
            category: "Injeção (OWASP A03)",
            severity: "critical",
            status: "open",
            affectedResource: `${baseUrl}/?${param}=`,
            description: `O parâmetro '${param}' retornou mensagem de erro SQL ao receber o payload '${payload}', confirmando SQL Injection. Erros detalhados de banco estão sendo expostos ao cliente.`,
            rationale: "SQL Injection permite ao atacante ler, modificar ou excluir dados, contornar autenticação e em muitos servidores executar comandos no sistema operacional.",
            remediation: "1. Substitua toda concatenação SQL por prepared statements.\n2. Configure o banco para não expor erros em produção.\n3. Implemente WAF como defesa adicional.\n4. Revise todas as queries da aplicação.\n5. Aplique o princípio do menor privilégio na conta do banco.",
            references: ["OWASP A03:2021 — Injection", "CWE-89"],
            evidence: { url, param, payload, responseSnippet: body.substring(0, 400) },
          }];
        }
      } catch {
        // Connection error or timeout — continue
      }
    }
  }
  return [];
}

const XSS_PAYLOADS = [
  { payload: "<script>alert(1)</script>", indicator: "<script>alert(1)" },
  { payload: '"><img src=x onerror=alert(1)>', indicator: "onerror=alert(1)" },
  { payload: "<svg onload=alert(1)>", indicator: "onload=alert(1)" },
];

const XSS_TEST_PARAMS = ["q", "search", "query", "name", "input", "msg", "comment", "s", "keyword", "term"];

async function checkXSS(host: string, port: number, https: boolean): Promise<Check[]> {
  const proto = https ? "https" : "http";
  const baseUrl = `${proto}://${host}:${port}`;

  let baselineStatus = 0;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${baseUrl}/`, { method: "GET", redirect: "manual", signal: ctrl.signal });
    clearTimeout(t);
    baselineStatus = res.status;
  } catch {
    return [];
  }
  if (![200, 301, 302, 403, 401].includes(baselineStatus)) return [];

  for (const param of XSS_TEST_PARAMS) {
    for (const { payload, indicator } of XSS_PAYLOADS) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        const url = `${baseUrl}/?${param}=${encodeURIComponent(payload)}`;
        const res = await fetch(url, {
          method: "GET",
          redirect: "manual",
          signal: ctrl.signal,
          headers: { "User-Agent": "Mozilla/5.0 (compatible; SecurityScanner/1.0)" },
        });
        clearTimeout(t);
        const body = await res.text().catch(() => "");
        if (body.includes(indicator)) {
          return [{
            controlId: `EXT.WEB.XSS.REFLECTED.${port}`,
            title: "Cross-Site Scripting (XSS) Refletido confirmado",
            category: "XSS (OWASP A03)",
            severity: "high",
            status: "open",
            affectedResource: `${baseUrl}/?${param}=`,
            description: `O parâmetro '${param}' reflete o payload XSS sem sanitização: '${indicator}' aparece não-codificado no HTML da resposta.`,
            rationale: "XSS refletido permite que atacantes criem links maliciosos que executam scripts no navegador da vítima, roubando sessões, credenciais ou redirecionando para phishing.",
            remediation: "1. Encode todos os dados dinâmicos para o contexto HTML (HTML entity encoding).\n2. Implemente Content-Security-Policy rigorosa.\n3. Use frameworks com encoding automático (React, Angular, Vue).\n4. Valide e rejeite inputs com caracteres HTML no servidor.",
            references: ["OWASP A03:2021 — XSS", "CWE-79"],
            evidence: { url, param, payload, reflectedIndicator: indicator },
          }];
        }
      } catch {
        // Continue
      }
    }
  }
  return [];
}

const BRUTE_HTTP_CREDS: [string, string][] = [
  ["admin", "admin"], ["admin", "password"], ["admin", "123456"],
  ["admin", "admin123"], ["admin", "pass"], ["admin", ""],
  ["root", "root"], ["root", "toor"], ["root", "password"],
  ["user", "user"], ["user", "password"], ["test", "test"],
  ["guest", "guest"], ["administrator", "administrator"],
  ["admin", "1234"], ["admin", "qwerty"], ["admin", "letmein"],
];

const BRUTE_FTP_CREDS: [string, string][] = [
  ["anonymous", "anonymous@scan.local"],
  ["ftp", "ftp"], ["admin", "admin"], ["root", "root"], ["user", "user"],
];

async function tryFtpLogin(host: string, user: string, pass: string): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let stage = 0;
    let buf = "";
    const done = (success: boolean) => { sock.destroy(); resolve(success); };
    sock.setTimeout(6000);
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
    sock.on("data", (chunk) => {
      buf += chunk.toString();
      if (stage === 0 && buf.includes("220")) {
        sock.write(`USER ${user}\r\n`); stage = 1; buf = "";
      } else if (stage === 1) {
        if (buf.includes("230")) { done(true); return; }
        if (buf.includes("331")) { sock.write(`PASS ${pass}\r\n`); stage = 2; buf = ""; }
        else { done(false); }
      } else if (stage === 2) {
        if (buf.includes("230")) { done(true); return; }
        done(false);
      }
    });
    sock.connect(21, host);
  });
}

async function checkBruteForce(
  host: string,
  openPorts: Array<{ port: number; service: string; banner: string | null }>,
): Promise<Check[]> {
  const findings: Check[] = [];

  // FTP brute force
  if (openPorts.some((p) => p.port === 21)) {
    for (const [user, pass] of BRUTE_FTP_CREDS) {
      const ok = await tryFtpLogin(host, user, pass).catch(() => false);
      if (ok) {
        findings.push({
          controlId: "EXT.AUTH.FTP.BRUTE",
          title: `Credenciais padrão aceitas no FTP: ${user}:${pass || "(vazio)"}`,
          category: "Autenticação Fraca (OWASP A07)",
          severity: "critical",
          status: "open",
          affectedResource: `ftp://${host}:21`,
          description: `Login FTP bem-sucedido com '${user}:${pass || "(vazio)"}'. O servidor aceita credenciais padrão ou acesso anônimo.`,
          rationale: "FTP com credenciais padrão permite que qualquer atacante acesse, exfiltre ou sobrescreva arquivos, podendo fazer upload de shells e comprometer o servidor.",
          remediation: "1. Desabilite FTP anônimo.\n2. Altere credenciais padrão para senhas fortes.\n3. Substitua FTP por SFTP ou FTPS com TLS.\n4. Bloqueie porta 21 na borda se não houver necessidade externa.",
          references: ["CWE-1391", "OWASP A07:2021 — Authentication Failures"],
          evidence: { username: user, password: pass || "(vazio)", protocol: "FTP" },
        });
        break;
      }
    }
  }

  // HTTP Basic Auth brute force
  const httpWebPorts = openPorts.filter((p) => HTTP_PORTS.has(p.port) || HTTPS_PORTS.has(p.port));
  for (const { port } of httpWebPorts) {
    const isHttps = HTTPS_PORTS.has(port);
    const proto = isHttps ? "https" : "http";
    const url = `${proto}://${host}:${port}/`;
    let requiresBasicAuth = false;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(url, { method: "GET", redirect: "manual", signal: ctrl.signal });
      clearTimeout(t);
      const auth = res.headers.get("www-authenticate") ?? "";
      requiresBasicAuth = res.status === 401 && auth.toLowerCase().includes("basic");
    } catch {
      continue;
    }
    if (!requiresBasicAuth) continue;

    for (const [user, pass] of BRUTE_HTTP_CREDS) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 4000);
        const cred = Buffer.from(`${user}:${pass}`).toString("base64");
        const res = await fetch(url, {
          method: "GET",
          headers: { Authorization: `Basic ${cred}` },
          redirect: "manual",
          signal: ctrl.signal,
        });
        clearTimeout(t);
        if (res.status !== 401) {
          findings.push({
            controlId: `EXT.AUTH.HTTP.BRUTE.${port}`,
            title: `Credenciais padrão aceitas — HTTP Basic Auth (porta ${port})`,
            category: "Autenticação Fraca (OWASP A07)",
            severity: "critical",
            status: "open",
            affectedResource: url,
            description: `Login bem-sucedido com '${user}:${pass || "(vazio)"}' via HTTP Basic Auth. O recurso retornou ${res.status} com essas credenciais.`,
            rationale: "Credenciais padrão são a primeira tentativa de qualquer scanner ou atacante. Acesso obtido a este recurso.",
            remediation: "1. Altere imediatamente as credenciais para senhas fortes e únicas.\n2. Implemente bloqueio após tentativas falhas.\n3. Substitua HTTP Basic Auth por autenticação moderna.\n4. Habilite MFA onde possível.",
            references: ["CWE-1391", "OWASP A07:2021"],
            evidence: { url, username: user, password: pass || "(vazio)", responseCode: res.status },
          });
          break;
        }
      } catch {
        // Continue
      }
    }
  }

  return findings;
}

async function runScanForHost(host: string): Promise<ExternalScanResult> {
  const findings: Check[] = [];
  const openPortsList: Array<{ port: number; service: string; banner: string | null }> = [];

  // Port scan with concurrency limit
  const concurrency = 8;
  const tasks = [...COMMON_PORTS];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i += 1) {
    workers.push(
      (async () => {
        while (tasks.length > 0) {
          const item = tasks.shift();
          if (!item) return;
          try {
            const r = await scanPort(host, item.port, item.service);
            findings.push(...r.findings);
            if (r.open) openPortsList.push({ port: item.port, service: item.service, banner: r.banner });
          } catch (err) {
            logger.warn(
              { err, port: item.port, host },
              "Port scan worker failed",
            );
          }
        }
      })(),
    );
  }
  await Promise.all(workers);

  findings.push(...(await dnsChecks(host)));

  // Passive web checks (exposed paths + CORS) on standard ports + any other open web ports
  const webPortSet = new Set<number>([80, 443]);
  for (const p of openPortsList) {
    if (HTTP_PORTS.has(p.port) || HTTPS_PORTS.has(p.port)) webPortSet.add(p.port);
  }
  const passiveWebTasks: Promise<Check[]>[] = [];
  for (const port of webPortSet) {
    const isHttps = HTTPS_PORTS.has(port);
    passiveWebTasks.push(exposedPathsCheck(host, port, isHttps), corsCheck(host, port, isHttps));
  }
  const passiveWebResults = await Promise.all(passiveWebTasks);
  for (const r of passiveWebResults) findings.push(...r);

  // Active pentest: SQLi and XSS on open web ports
  const openWebPorts = openPortsList.filter((p) => HTTP_PORTS.has(p.port) || HTTPS_PORTS.has(p.port));
  if (openWebPorts.length > 0) {
    const activeTasks: Promise<Check[]>[] = [];
    for (const p of openWebPorts) {
      const isHttps = HTTPS_PORTS.has(p.port);
      activeTasks.push(checkSQLi(host, p.port, isHttps));
      activeTasks.push(checkXSS(host, p.port, isHttps));
    }
    const activeResults = await Promise.all(activeTasks);
    for (const r of activeResults) findings.push(...r);
  }

  // Active pentest: credential brute force on open services
  findings.push(...(await checkBruteForce(host, openPortsList)));

  let critical = 0,
    high = 0,
    medium = 0,
    low = 0;
  for (const f of findings) {
    if (f.severity === "critical") critical += 1;
    else if (f.severity === "high") high += 1;
    else if (f.severity === "medium") medium += 1;
    else if (f.severity === "low") low += 1;
  }

  return {
    findings,
    totals: {
      total: findings.length,
      passed: 0,
      failed: findings.length,
      critical,
      high,
      medium,
      low,
    },
  };
}

function isPrivateIPv4(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local + AWS metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("ff")) return true; // multicast
  if (lower.startsWith("::ffff:")) {
    const v4 = lower.slice(7);
    return isPrivateIPv4(v4);
  }
  return false;
}

export async function assertHostIsPublic(host: string): Promise<void> {
  const trimmed = host.trim();
  if (!trimmed) throw new Error("Host vazio");
  // bloqueia hostnames internos óbvios
  const lowered = trimmed.toLowerCase();
  if (
    lowered === "localhost" ||
    lowered.endsWith(".localhost") ||
    lowered.endsWith(".local") ||
    lowered.endsWith(".internal") ||
    lowered.endsWith(".intranet") ||
    lowered === "metadata.google.internal"
  ) {
    throw new Error(`Host não permitido: ${trimmed}`);
  }

  // Se já é um IP literal, valida direto
  const ipKind = net.isIP(trimmed);
  if (ipKind === 4 && isPrivateIPv4(trimmed)) {
    throw new Error(`IP privado não permitido: ${trimmed}`);
  }
  if (ipKind === 6 && isPrivateIPv6(trimmed)) {
    throw new Error(`IP privado não permitido: ${trimmed}`);
  }
  if (ipKind !== 0) return;

  // Resolve DNS e valida cada endereço
  let addrs: { address: string; family: number }[] = [];
  try {
    addrs = await dns.lookup(trimmed, { all: true, verbatim: true });
  } catch {
    throw new Error(`Não foi possível resolver o host: ${trimmed}`);
  }
  if (addrs.length === 0) {
    throw new Error(`Host sem registros DNS: ${trimmed}`);
  }
  for (const a of addrs) {
    if (a.family === 4 && isPrivateIPv4(a.address)) {
      throw new Error(
        `Host ${trimmed} resolve para IP privado (${a.address})`,
      );
    }
    if (a.family === 6 && isPrivateIPv6(a.address)) {
      throw new Error(
        `Host ${trimmed} resolve para IP privado (${a.address})`,
      );
    }
  }
}

export async function runExternalScan(deviceScanId: string): Promise<void> {
  const [scan] = await db
    .select()
    .from(deviceScansTable)
    .where(eq(deviceScansTable.id, deviceScanId))
    .limit(1);
  if (!scan) throw new Error(`scan ${deviceScanId} not found`);

  const [asset] = await db
    .select()
    .from(externalAssetsTable)
    .where(eq(externalAssetsTable.id, scan.deviceId))
    .limit(1);
  if (!asset) throw new Error(`external asset ${scan.deviceId} not found`);

  try {
    await assertHostIsPublic(asset.host);
  } catch (err) {
    logger.warn(
      { err, host: asset.host, scanId: deviceScanId },
      "External scan rejected: host blocked",
    );
    const reason = err instanceof Error ? err.message : String(err);
    await db
      .insert(deviceFindingsTable)
      .values([
        {
          deviceScanId,
          controlId: "EXT-HOST-BLOCKED",
          title: "Host bloqueado para varredura",
          category: "Network",
          severity: "info",
          status: "open",
          affectedResource: asset.host,
          description: reason,
          rationale:
            "Apenas IPs e domínios públicos podem ser analisados (proteção contra SSRF e varredura de rede interna).",
          remediation:
            "Informe um endereço público válido (IP roteável na Internet ou domínio).",
        },
      ]);
    await db
      .update(deviceScansTable)
      .set({ status: "failed", completedAt: new Date() })
      .where(eq(deviceScansTable.id, deviceScanId));
    return;
  }

  const result = await runScanForHost(asset.host);

  if (result.findings.length > 0) {
    await db
      .insert(deviceFindingsTable)
      .values(result.findings.map((f) => ({ ...f, deviceScanId })));
  }

  await db
    .update(deviceScansTable)
    .set({
      status: "completed",
      completedAt: new Date(),
      totalChecks: result.totals.total,
      passedChecks: 0,
      failedChecks: result.totals.failed,
      criticalCount: result.totals.critical,
      highCount: result.totals.high,
      mediumCount: result.totals.medium,
      lowCount: result.totals.low,
    })
    .where(eq(deviceScansTable.id, deviceScanId));

  await db
    .update(externalAssetsTable)
    .set({ lastScanAt: new Date(), updatedAt: new Date() })
    .where(eq(externalAssetsTable.id, asset.id));
}
