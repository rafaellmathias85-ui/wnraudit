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

export const COMMON_PORTS: Array<{ port: number; service: string }> = [
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

export const HIGH_RISK_EXPOSED_PORTS = new Set<number>([
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
  {
    key: "permissions-policy",
    name: "Permissions-Policy",
    severity: "low" as Severity,
    remediation:
      "Adicione Permissions-Policy para restringir recursos do navegador: 'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()'.",
    rationale:
      "Sem Permissions-Policy, scripts maliciosos injetados via XSS podem acessar câmera, microfone e geolocalização do usuário.",
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

// Returns the apex/root domain for DNS checks.
// www.wticorp.com.br → wticorp.com.br (handles 2-level ccTLDs like .com.br, .co.uk)
function getApexDomain(host: string): string {
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  // Known 2-level ccTLDs — take 3 rightmost labels as root
  const secondLevel = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  const twoPartTlds = new Set([
    "com.br", "org.br", "net.br", "edu.br", "gov.br", "mil.br", "nom.br",
    "co.uk", "org.uk", "me.uk", "ltd.uk", "plc.uk",
    "com.au", "org.au", "net.au", "edu.au", "gov.au",
    "co.jp", "or.jp", "ne.jp", "ac.jp", "co.nz", "org.nz",
    "com.ar", "com.mx", "com.co", "com.pe", "com.pt",
  ]);
  if (twoPartTlds.has(secondLevel) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
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
  { path: "/.git/config",         title: "Arquivo .git/config exposto (credenciais, remote URLs)",     severity: "critical" as Severity },
  { path: "/swagger.json",        title: "OpenAPI/Swagger spec exposta publicamente",                   severity: "medium" as Severity },
  { path: "/swagger-ui.html",     title: "Swagger UI exposta — exploração interativa da API",           severity: "medium" as Severity },
  { path: "/api-docs",            title: "Documentação de API exposta (/api-docs)",                     severity: "medium" as Severity },
  { path: "/graphql",             title: "Endpoint GraphQL exposto sem autenticação",                   severity: "medium" as Severity },
  { path: "/graphiql",            title: "GraphiQL IDE exposto publicamente",                           severity: "high" as Severity },
  { path: "/actuator/env",        title: "Spring Actuator /env exposto (variáveis de ambiente)",        severity: "critical" as Severity },
  { path: "/debug",               title: "Endpoint /debug exposto",                                     severity: "high" as Severity },
  { path: "/metrics",             title: "Endpoint /metrics exposto (Prometheus)",                      severity: "medium" as Severity },
  { path: "/web.config",          title: "Arquivo web.config exposto (configuração IIS)",               severity: "critical" as Severity },
  { path: "/.svn/entries",        title: "Repositório SVN exposto",                                     severity: "critical" as Severity },
  { path: "/WEB-INF/web.xml",     title: "web.xml exposto (configuração Java/Tomcat)",                  severity: "critical" as Severity },
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
  // DNS email records live on the apex domain, not on www.* subdomains
  const apex = getApexDomain(host);
  try {
    const txts = await dns.resolveTxt(apex).catch(() => [] as string[][]);
    const flat = txts.map((t) => t.join(""));
    const hasSpf = flat.some((t) => /^v=spf1/i.test(t));
    if (!hasSpf) {
      findings.push({
        controlId: "EXT.DNS.SPF",
        title: "Registro SPF ausente",
        category: "DNS / E-mail",
        severity: "medium",
        status: "open",
        affectedResource: `${apex} (TXT)`,
        description:
          `Não foi encontrado registro SPF (v=spf1) para o domínio ${apex}. Sem SPF, qualquer servidor pode falsificar e-mails em nome do seu domínio.`,
        rationale:
          "SPF é uma das três pernas do DMARC. Sem ele, o domínio é facilmente usado em campanhas de phishing contra clientes e parceiros.",
        remediation:
          "1. Identifique todos os servidores que enviam e-mail pelo seu domínio.\n2. Crie um registro TXT: v=spf1 include:_spf.google.com -all (ajuste para o seu provedor).\n3. Termine com -all (reject) ou ~all (softfail). Evite +all.\n4. Valide com MXToolbox SPF Checker.",
        references: ["RFC 7208", "https://mxtoolbox.com/spf.aspx"],
        evidence: { apexDomain: apex, txtRecords: flat },
      });
    }
    const dmarcRaw = await dns
      .resolveTxt(`_dmarc.${apex}`)
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
        affectedResource: `_dmarc.${apex}`,
        description:
          `O domínio ${apex} não publica registro DMARC. Mensagens forjadas em nome do domínio passam sem ação dos servidores receptores.`,
        rationale:
          "DMARC instrui provedores receptores (Gmail, Outlook) a rejeitar ou colocar em quarentena e-mails que falharem em SPF/DKIM. Sem DMARC, ataques de spoofing chegam à caixa de entrada.",
        remediation:
          "1. Crie um registro TXT em _dmarc.{dominio}.\n2. Valor mínimo: v=DMARC1; p=quarantine; rua=mailto:dmarc@{dominio}\n3. Monitore os relatórios por 2-4 semanas.\n4. Após validar que o tráfego legítimo está alinhado, evolua para p=reject.",
        references: ["RFC 7489", "https://mxtoolbox.com/dmarc.aspx"],
        evidence: { apexDomain: apex, dmarcRecords: dmarcFlat },
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
          affectedResource: `_dmarc.${apex}`,
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

    // DKIM check (apex domain, not www.* subdomain)
    const dkimFinding = await dkimCheck(apex);
    if (dkimFinding) findings.push(dkimFinding);

    // MTA-STS check (apex domain)
    const mtaFindings = await mtaStsCheck(apex);
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

// ─── Supply Chain ─────────────────────────────────────────────────────────────

const SUPPLY_CHAIN_PATHS: Array<{ path: string; title: string; severity: Severity }> = [
  { path: "/package.json",          title: "package.json exposto (inventário de dependências Node.js)",    severity: "high" },
  { path: "/package-lock.json",     title: "package-lock.json exposto (lockfile com árvore de deps exata)", severity: "high" },
  { path: "/yarn.lock",             title: "yarn.lock exposto (lockfile Yarn)",                            severity: "medium" },
  { path: "/pnpm-lock.yaml",        title: "pnpm-lock.yaml exposto (lockfile pnpm)",                      severity: "medium" },
  { path: "/composer.json",         title: "composer.json exposto (dependências PHP)",                     severity: "high" },
  { path: "/composer.lock",         title: "composer.lock exposto (lockfile Composer)",                    severity: "high" },
  { path: "/Gemfile",               title: "Gemfile exposto (dependências Ruby)",                          severity: "high" },
  { path: "/Gemfile.lock",          title: "Gemfile.lock exposto (lockfile Ruby)",                         severity: "high" },
  { path: "/requirements.txt",      title: "requirements.txt exposto (dependências Python)",               severity: "medium" },
  { path: "/Pipfile.lock",          title: "Pipfile.lock exposto (lockfile Python)",                       severity: "medium" },
  { path: "/go.mod",                title: "go.mod exposto (módulos Go)",                                  severity: "medium" },
  { path: "/.npmrc",                title: ".npmrc exposto — pode conter tokens de registro npm",          severity: "critical" },
  { path: "/.yarnrc.yml",           title: ".yarnrc.yml exposto — pode conter tokens de registro Yarn",   severity: "critical" },
  { path: "/npm-shrinkwrap.json",   title: "npm-shrinkwrap.json exposto",                                 severity: "medium" },
  { path: "/Cargo.toml",            title: "Cargo.toml exposto (dependências Rust)",                      severity: "medium" },
];

async function checkSupplyChain(host: string, port: number, isHttps: boolean): Promise<Check[]> {
  const findings: Check[] = [];
  const proto = isHttps ? "https" : "http";
  const baseUrl = `${proto}://${host}:${port}`;

  // 1. Exposed dependency/lockfiles
  for (const ep of SUPPLY_CHAIN_PATHS) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(`${baseUrl}${ep.path}`, { method: "GET", redirect: "manual", signal: ctrl.signal });
      clearTimeout(t);
      if (res.status === 200) {
        const body = await res.text().catch(() => "");
        if (body.length > 30) {
          findings.push({
            controlId: `EXT.SC.FILE${ep.path.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}`,
            title: ep.title,
            category: "Supply Chain / Dependências",
            severity: ep.severity,
            status: "open",
            affectedResource: `${baseUrl}${ep.path}`,
            description: `O arquivo ${ep.path} está publicamente acessível. Expõe o inventário completo de dependências, versões exatas e possíveis tokens de autenticação — informações valiosas para construir ataques de supply chain.`,
            rationale: "Atacantes usam arquivos de dependência para identificar bibliotecas com vulnerabilidades conhecidas (CVEs) e planejar ataques de dependency confusion ou typosquatting.",
            remediation: `1. Bloqueie o acesso ao caminho ${ep.path} no servidor web (nginx: return 404; Apache: Deny from all).\n2. Garanta que arquivos de dependência nunca estejam no webroot público.\n3. Para .npmrc e .yarnrc: revogue e rotacione qualquer token exposto imediatamente.`,
            references: ["OWASP A06:2021 — Vulnerable and Outdated Components", "ISO 27001 A.15.2"],
            evidence: { url: `${baseUrl}${ep.path}`, snippet: body.substring(0, 200) },
          });
        }
      }
    } catch {
      // timeout / connection refused = file not exposed
    }
  }

  // 2. SRI check — external scripts/stylesheets without Subresource Integrity
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(`${baseUrl}/`, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SecurityScanner/1.0)" },
    });
    clearTimeout(t);
    if (res.ok) {
      const html = await res.text().catch(() => "");
      const missingIntegrity: string[] = [];

      const tagRegex = /<(script|link)\b([^>]*)>/gi;
      let m;
      while ((m = tagRegex.exec(html)) !== null) {
        const tagName = m[1].toLowerCase();
        const attrs = m[2];
        // Only interested in script[src] and link[rel=stylesheet][href]
        const srcMatch = tagName === "script"
          ? /\bsrc=["']([^"']+)["']/i.exec(attrs)
          : /\bhref=["']([^"']+)["']/i.exec(attrs);
        if (!srcMatch) continue;
        if (tagName === "link" && !/\brel=["'][^"']*stylesheet[^"']*["']/i.test(attrs)) continue;
        const src = srcMatch[1];
        const isExternal = src.startsWith("http://") || src.startsWith("https://") || src.startsWith("//");
        if (!isExternal) continue;
        try {
          const srcHost = new URL(src.startsWith("//") ? `https:${src}` : src).hostname;
          if (srcHost === host) continue;
        } catch { continue; }
        const hasIntegrity = /\bintegrity=["'][^"']+["']/.test(attrs);
        if (!hasIntegrity) missingIntegrity.push(src.substring(0, 100));
      }

      if (missingIntegrity.length > 0) {
        findings.push({
          controlId: `EXT.SC.SRI.${port}`,
          title: `${missingIntegrity.length} recurso(s) externo(s) sem Subresource Integrity (SRI)`,
          category: "Supply Chain / Dependências",
          severity: "high",
          status: "open",
          affectedResource: `${baseUrl}/`,
          description: `A página carrega ${missingIntegrity.length} script(s)/stylesheet(s) de domínios externos sem atributo integrity=. Um atacante que comprometa o CDN pode injetar código malicioso executado em todos os navegadores dos usuários (ataque Magecart/supply chain de CDN).\n\nRecursos afetados:\n${missingIntegrity.map((s) => `• ${s}`).join("\n")}`,
          rationale: "Sem SRI, o navegador executa qualquer conteúdo retornado pelo CDN, mesmo que adulterado. Ataques Magecart usaram exatamente essa técnica para roubar dados de cartão em milhares de sites.",
          remediation: "1. Para cada script externo, gere o hash: openssl dgst -sha384 -binary <(curl -s URL) | base64\n2. Adicione integrity=\"sha384-HASH\" crossorigin=\"anonymous\" ao tag.\n3. Considere hospedar scripts críticos no seu próprio domínio.\n4. Use ferramentas como SRI Hash Generator (srihash.org).",
          references: ["OWASP A08:2021 — Software and Data Integrity Failures", "ISO 27001 A.15.2", "CWE-829"],
          evidence: { missingIntegrityResources: missingIntegrity },
        });
      }
    }
  } catch {
    // page fetch failed
  }

  return findings;
}

// ─── Login Form Testing ────────────────────────────────────────────────────────

const LOGIN_PATHS = [
  "/", "/login", "/signin", "/auth", "/auth/login",
  "/user/login", "/account/login", "/admin", "/admin/login",
  "/wp-login.php", "/portal", "/dashboard",
];

const FORM_DEFAULT_CREDS: [string, string][] = [
  ["admin", "admin"], ["admin", "password"], ["admin", "123456"],
  ["admin", "admin123"], ["admin", "pass"], ["admin", ""],
  ["root", "root"], ["root", "password"], ["administrator", "administrator"],
  ["test", "test"], ["guest", "guest"], ["user", "user"],
  ["admin", "1234"], ["admin", "qwerty"], ["admin", "letmein"],
];

async function checkLoginForms(host: string, port: number, isHttps: boolean): Promise<Check[]> {
  const findings: Check[] = [];
  const proto = isHttps ? "https" : "http";
  const baseUrl = `${proto}://${host}:${port}`;
  const testedActions = new Set<string>();

  for (const loginPath of LOGIN_PATHS) {
    let html = "";
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`${baseUrl}${loginPath}`, {
        method: "GET",
        redirect: "follow",
        signal: ctrl.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SecurityScanner/1.0)" },
      });
      clearTimeout(t);
      if (!res.ok) continue;
      html = await res.text().catch(() => "");
    } catch { continue; }

    // Find forms containing a password field
    const formRegex = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
    let formMatch;
    while ((formMatch = formRegex.exec(html)) !== null) {
      const formAttrs = formMatch[1];
      const formBody = formMatch[2];
      if (!/<input\b[^>]+type=["']password["']/i.test(formBody)) continue;

      // Resolve action URL
      const actionAttr = /\baction=["']([^"']*?)["']/i.exec(formAttrs);
      let action = actionAttr ? actionAttr[1] : loginPath;
      if (!action || action === "#") action = loginPath;
      if (action.startsWith("/")) action = `${baseUrl}${action}`;
      else if (!action.startsWith("http")) action = `${baseUrl}/${action}`;
      if (testedActions.has(action)) continue;
      testedActions.add(action);

      const methodAttr = /\bmethod=["']([^"']+)["']/i.exec(formAttrs);
      const method = (methodAttr ? methodAttr[1] : "POST").toUpperCase();

      // Extract all input fields
      const fields: Array<{ name: string; type: string }> = [];
      const inputRegex = /<input\b[^>]+>/gi;
      let inp;
      while ((inp = inputRegex.exec(formBody)) !== null) {
        const nameM = /\bname=["']([^"']+)["']/i.exec(inp[0]);
        if (!nameM) continue;
        const typeM = /\btype=["']([^"']+)["']/i.exec(inp[0]);
        fields.push({ name: nameM[1], type: (typeM ? typeM[1] : "text").toLowerCase() });
      }

      // CSRF check
      const hasCsrf = fields.some((f) => /csrf|_token|authenticity_token|nonce/i.test(f.name));
      if (!hasCsrf) {
        findings.push({
          controlId: `EXT.LOGIN.CSRF.${port}`,
          title: "Formulário de login sem proteção CSRF",
          category: "Autenticação (OWASP A07)",
          severity: "medium",
          status: "open",
          affectedResource: action,
          description: `O formulário de login em ${loginPath} não contém token CSRF nos campos detectados (${fields.map((f) => f.name).join(", ")}). Isso permite que páginas de terceiros forcem submissões do formulário em nome do usuário.`,
          rationale: "Ataques CSRF em formulários de login possibilitam session fixation — o atacante força o login com credenciais controladas por ele, depois assume a sessão quando a vítima acessa o site.",
          remediation: "1. Adicione campo hidden com token CSRF gerado por sessão.\n2. Valide o token servidor a cada POST.\n3. Frameworks modernos (Django, Rails, Laravel, Spring Security) implementam isso automaticamente.",
          references: ["OWASP A01:2021 — Broken Access Control", "CWE-352", "ISO 27001 A.8.5"],
          evidence: { loginPath, action, detectedFields: fields.map((f) => f.name) },
        });
      }

      // Identify credential fields
      const userFields = fields.filter((f) => /user|email|login|nome|name|username|usuario/i.test(f.name) && f.type !== "password" && f.type !== "hidden");
      const passFields = fields.filter((f) => f.type === "password");
      if (userFields.length === 0 || passFields.length === 0) continue;

      const buildFormBody = (user: string, pass: string): string => {
        const params = new URLSearchParams();
        for (const f of fields) {
          if (f.name === userFields[0].name) params.set(f.name, user);
          else if (f.name === passFields[0].name) params.set(f.name, pass);
          else if (f.type !== "hidden") params.set(f.name, "audit_check");
        }
        return params.toString();
      };

      const postForm = async (user: string, pass: string) => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(action, {
          method,
          redirect: "manual",
          signal: ctrl.signal,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0 (compatible; SecurityScanner/1.0)",
          },
          body: buildFormBody(user, pass),
        });
        clearTimeout(t);
        return { status: res.status, location: res.headers.get("location") ?? "", body: await res.text().catch(() => "") };
      };

      // SQLi in login form username field
      let loginSqlFound = false;
      for (const payload of ["' OR '1'='1'--", "' OR 1=1--", "admin'--"]) {
        try {
          const { body } = await postForm(payload, "anypassword");
          const hasSqlError = SQLI_ERROR_PATTERNS.some((p) => p.test(body));
          if (hasSqlError) {
            loginSqlFound = true;
            findings.push({
              controlId: `EXT.LOGIN.SQLI.${port}`,
              title: "SQL Injection no campo de usuário do formulário de login",
              category: "Injeção (OWASP A03)",
              severity: "critical",
              status: "open",
              affectedResource: action,
              description: `O campo '${userFields[0].name}' do formulário de login em ${loginPath} retornou erro SQL ao receber o payload '${payload}'. Isso indica SQL Injection na query de autenticação — o atacante pode contornar o login completamente.`,
              rationale: "SQL Injection em login é crítico: o atacante pode autenticar-se sem credenciais válidas, fazer dump de toda a tabela de usuários ou assumir qualquer conta.",
              remediation: "1. Substitua a query de autenticação por prepared statements.\n2. Nunca concatene entrada do usuário em SQL.\n3. Configure o banco para não expor erros em produção.\n4. Implemente rate limiting no endpoint de login.",
              references: ["OWASP A03:2021 — Injection", "CWE-89", "ISO 27001 A.8.29"],
              evidence: { action, field: userFields[0].name, payload, responseSnippet: "" },
            });
            break;
          }
        } catch { /* continue */ }
      }

      // Default credential testing on form (skip if SQLi already confirmed)
      if (!loginSqlFound) {
        try {
          const baseline = await postForm("wronguser_auditcheck_99887", "wrongpass_auditcheck_99887");
          for (const [user, pass] of FORM_DEFAULT_CREDS) {
            try {
              const { status, location, body } = await postForm(user, pass);
              const successRedirect = (status === 301 || status === 302) &&
                location && !/(login|signin|error|failed|invalid)/i.test(location);
              const successBody = /logout|sign.?out|dashboard|painel|bem.?vindo|welcome|my.?account/i.test(body) &&
                !/<input\b[^>]+type=["']password["']/i.test(body);
              const bodyDiffers = Math.abs(body.length - baseline.body.length) > 200;
              if (successRedirect || (successBody && bodyDiffers)) {
                findings.push({
                  controlId: `EXT.LOGIN.DEFAULTCRED.${port}`,
                  title: `Credencial padrão aceita no formulário de login: ${user}/${pass || "(sem senha)"}`,
                  category: "Autenticação (OWASP A07)",
                  severity: "critical",
                  status: "open",
                  affectedResource: action,
                  description: `O formulário de login em ${loginPath} aceitou as credenciais padrão "${user}" / "${pass || "(vazia)"}". Acesso não autorizado provavelmente obtido — o servidor retornou indicadores de sessão autenticada.`,
                  rationale: "Credenciais padrão são o vetor de ataque mais comum em aplicações web e IoT. Um atacante pode assumir a conta admin imediatamente sem qualquer técnica avançada.",
                  remediation: "1. Altere a senha imediatamente para uma senha forte e única.\n2. Force troca de senha no primeiro acesso.\n3. Implemente bloqueio após N tentativas falhas (rate limiting).\n4. Habilite MFA para contas administrativas.",
                  references: ["CWE-1391", "OWASP A07:2021 — Identification and Authentication Failures", "ISO 27001 A.8.5"],
                  evidence: { action, username: user, password: pass || "(vazia)", responseStatus: status, redirectLocation: location || undefined },
                });
                break;
              }
            } catch { /* continue */ }
          }
        } catch { /* baseline fetch failed */ }
      }
    }
  }

  return findings;
}

// ─── HTTP Dangerous Methods ────────────────────────────────────────────────────

async function checkHttpMethods(host: string, port: number, isHttps: boolean): Promise<Check[]> {
  const findings: Check[] = [];
  const proto = isHttps ? "https" : "http";
  const baseUrl = `${proto}://${host}:${port}`;

  // TRACE — enables XST (Cross-Site Tracing) attack
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${baseUrl}/`, {
      method: "TRACE",
      redirect: "manual",
      signal: ctrl.signal,
      headers: { "X-Audit-Probe": "wnraudit-trace-test" },
    });
    clearTimeout(t);
    const body = await res.text().catch(() => "");
    if (res.status === 200 && body.includes("wnraudit-trace-test")) {
      findings.push({
        controlId: `EXT.HTTP.TRACE.${port}`,
        title: "Método HTTP TRACE habilitado — risco de XST",
        category: "Configuração de Segurança",
        severity: "medium",
        status: "open",
        affectedResource: `${baseUrl}/`,
        description: `O servidor aceita requisições HTTP TRACE e reflete os cabeçalhos na resposta. Isso habilita Cross-Site Tracing (XST), um ataque que pode contornar proteções HttpOnly quando combinado com XSS.`,
        rationale: "TRACE é um método de debug do HTTP sem utilidade em produção. Combinado com XSS, permite roubar cookies marcados como HttpOnly que normalmente são inacessíveis por JavaScript.",
        remediation: "Desabilite o método TRACE no servidor web:\n- nginx: if ($request_method = TRACE) { return 405; }\n- Apache: TraceEnable Off no httpd.conf\n- IIS: Desative via Request Filtering.",
        references: ["OWASP — Cross-Site Tracing", "CWE-16"],
        evidence: { method: "TRACE", responseStatus: res.status },
      });
    }
  } catch { /* not supported */ }

  // PUT — possible file upload
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${baseUrl}/wnraudit-put-probe-${Date.now()}.txt`, {
      method: "PUT",
      redirect: "manual",
      signal: ctrl.signal,
      body: "wnraudit-put-probe",
      headers: { "Content-Type": "text/plain" },
    });
    clearTimeout(t);
    if (res.status === 200 || res.status === 201 || res.status === 204) {
      findings.push({
        controlId: `EXT.HTTP.PUT.${port}`,
        title: "Método HTTP PUT habilitado — possível upload arbitrário de arquivo",
        category: "Configuração de Segurança",
        severity: "critical",
        status: "open",
        affectedResource: `${baseUrl}/`,
        description: `O servidor retornou ${res.status} para uma requisição PUT sem autenticação. Isso indica que uploads arbitrários de arquivo podem ser possíveis, permitindo deploy de webshells.`,
        rationale: "Servidores com PUT habilitado sem controle de acesso permitem upload de scripts maliciosos que comprometem completamente o servidor.",
        remediation: "Desabilite o método HTTP PUT a menos que seja necessário para API REST autenticada:\n- nginx: if ($request_method = PUT) { return 405; }\n- Apache: Limit PUT DELETE PATCH em VirtualHost",
        references: ["OWASP — Unrestricted File Upload", "CWE-434"],
        evidence: { method: "PUT", responseStatus: res.status },
      });
    }
  } catch { /* not supported */ }

  // OPTIONS — enumerate allowed methods
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${baseUrl}/`, { method: "OPTIONS", redirect: "manual", signal: ctrl.signal });
    clearTimeout(t);
    const allow = (res.headers.get("allow") ?? res.headers.get("access-control-allow-methods") ?? "").toUpperCase();
    const dangerous = ["DELETE", "PUT", "PATCH"].filter((m) => allow.includes(m));
    if (dangerous.length > 0 && !findings.some((f) => f.controlId === `EXT.HTTP.PUT.${port}`)) {
      findings.push({
        controlId: `EXT.HTTP.METHODS.${port}`,
        title: `Métodos HTTP potencialmente perigosos habilitados: ${dangerous.join(", ")}`,
        category: "Configuração de Segurança",
        severity: "medium",
        status: "open",
        affectedResource: `${baseUrl}/`,
        description: `O servidor declara suporte aos métodos ${dangerous.join(", ")} no cabeçalho Allow. Sem autenticação e autorização estritas nesses métodos, podem permitir modificação ou exclusão de recursos.`,
        rationale: "Métodos HTTP destrutivos (DELETE, PUT, PATCH) sem controle de acesso adequado permitem que atacantes modifiquem ou removam dados e arquivos da aplicação.",
        remediation: "Restrinja os métodos HTTP ao mínimo necessário. Aplique autenticação obrigatória em DELETE/PUT/PATCH e documente cada endpoint que usa esses métodos.",
        references: ["OWASP A01:2021 — Broken Access Control"],
        evidence: { allowHeader: allow, dangerousMethods: dangerous },
      });
    }
  } catch { /* not supported */ }

  return findings;
}

// ─── Open Redirect ─────────────────────────────────────────────────────────────

const REDIRECT_PARAMS = [
  "next", "redirect", "url", "return", "returnUrl", "redirect_uri",
  "return_url", "callback", "goto", "dest", "destination", "redir",
];
const REDIRECT_PROBE_PATHS = ["/", "/login", "/auth", "/logout", "/redirect", "/go"];

async function checkOpenRedirect(host: string, port: number, isHttps: boolean): Promise<Check[]> {
  const proto = isHttps ? "https" : "http";
  const baseUrl = `${proto}://${host}:${port}`;
  const evilTarget = "https://evil-wnraudit-probe.example.com/stolen";

  for (const path of REDIRECT_PROBE_PATHS) {
    for (const param of REDIRECT_PARAMS) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 4000);
        const url = `${baseUrl}${path}?${param}=${encodeURIComponent(evilTarget)}`;
        const res = await fetch(url, {
          method: "GET",
          redirect: "manual",
          signal: ctrl.signal,
          headers: { "User-Agent": "Mozilla/5.0 (compatible; SecurityScanner/1.0)" },
        });
        clearTimeout(t);
        const location = res.headers.get("location") ?? "";
        const isRedirect = res.status >= 301 && res.status <= 308;
        if (isRedirect && location.includes("evil-wnraudit-probe.example.com")) {
          return [{
            controlId: `EXT.WEB.OPENREDIRECT.${port}`,
            title: "Open Redirect confirmado",
            category: "Redirecionamento Aberto (OWASP A01)",
            severity: "medium",
            status: "open",
            affectedResource: `${baseUrl}${path}?${param}=`,
            description: `O parâmetro '${param}' em ${path} redireciona para domínios externos sem validação (status ${res.status} → ${location.substring(0, 80)}). Um atacante pode criar links aparentemente legítimos que redirecionam para sites maliciosos.`,
            rationale: "Open Redirect é amplamente usado em phishing: o link parece confiável (domínio legítimo) mas redireciona a vítima para página de coleta de credenciais ou malware.",
            remediation: "1. Valide que o destino é um caminho relativo, não URL absoluta.\n2. Use allowlist de domínios para redirects externos.\n3. Nunca use parâmetros de URL como destino direto de redirect sem validação rigorosa.",
            references: ["OWASP A01:2021 — Broken Access Control", "CWE-601"],
            evidence: { url, param, path, location: location.substring(0, 100), statusCode: res.status },
          }];
        }
      } catch { /* continue */ }
    }
  }
  return [];
}

// ─── Cookie Security Flags ─────────────────────────────────────────────────────

async function checkCookieSecurity(host: string, port: number, isHttps: boolean): Promise<Check[]> {
  const findings: Check[] = [];
  const proto = isHttps ? "https" : "http";
  const baseUrl = `${proto}://${host}:${port}`;
  const pathsToTry = ["/", "/login", "/auth", "/dashboard", "/admin"];
  const seen = new Set<string>();

  for (const path of pathsToTry) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(`${baseUrl}${path}`, {
        method: "GET",
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SecurityScanner/1.0)" },
      });
      clearTimeout(t);

      const rawCookies: string[] = res.headers.getSetCookie?.() ?? [];
      for (const raw of rawCookies) {
        const nameMatch = /^([^=;,\s]+)/.exec(raw.trim());
        if (!nameMatch) continue;
        const name = nameMatch[1];
        if (seen.has(name)) continue;
        seen.add(name);

        // Only check likely session/auth cookies by name
        const isSessionCookie = /session|sess|auth|token|sid|_id|jwt|access|csrf/i.test(name);
        if (!isSessionCookie && rawCookies.length > 3) continue;

        const missing: string[] = [];
        if (isHttps && !/\bsecure\b/i.test(raw)) missing.push("Secure");
        if (!/\bhttponly\b/i.test(raw)) missing.push("HttpOnly");
        if (!/\bsamesite\s*=/i.test(raw)) missing.push("SameSite");

        if (missing.length === 0) continue;

        findings.push({
          controlId: `EXT.COOKIE.FLAGS.${port}.${name.substring(0, 20).replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}`,
          title: `Cookie de sessão sem flags de segurança: ${missing.join(", ")} (${name})`,
          category: "Gerenciamento de Sessão (OWASP A07)",
          severity: missing.includes("HttpOnly") && missing.includes("Secure") ? "high" : "medium",
          status: "open",
          affectedResource: `${baseUrl}${path}`,
          description: `O cookie '${name}' não possui: ${missing.join(", ")}.\n${missing.includes("HttpOnly") ? "• Sem HttpOnly: JavaScript pode ler e roubar o cookie via XSS\n" : ""}${missing.includes("Secure") ? "• Sem Secure: o cookie trafega em HTTP não criptografado\n" : ""}${missing.includes("SameSite") ? "• Sem SameSite: suscetível a CSRF cross-origin" : ""}`,
          rationale: "Cookies de sessão sem HttpOnly são roubáveis via XSS. Sem Secure, trafegam em texto claro. Sem SameSite, qualquer site pode disparar requisições autenticadas.",
          remediation: "Configure: Set-Cookie: " + name + "=...; HttpOnly; Secure; SameSite=Lax\n\nEm Express: res.cookie(name, value, { httpOnly: true, secure: true, sameSite: 'lax' })\nEm Django: SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SECURE=True, SESSION_COOKIE_SAMESITE='Lax'",
          references: ["OWASP A07:2021 — Session Management", "CWE-1004", "CWE-614"],
          evidence: { cookieName: name, missingFlags: missing, path },
        });
      }
    } catch { /* continue */ }
  }
  return findings;
}

// ─── Directory Listing ─────────────────────────────────────────────────────────

const DIR_LISTING_PATHS = [
  "/images/", "/uploads/", "/assets/", "/static/", "/files/",
  "/backup/", "/media/", "/img/", "/css/", "/js/", "/data/",
];

async function checkDirectoryListing(host: string, port: number, isHttps: boolean): Promise<Check[]> {
  const proto = isHttps ? "https" : "http";
  const baseUrl = `${proto}://${host}:${port}`;

  for (const path of DIR_LISTING_PATHS) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(`${baseUrl}${path}`, {
        method: "GET",
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SecurityScanner/1.0)" },
      });
      clearTimeout(t);
      if (res.status !== 200) continue;
      const body = await res.text().catch(() => "");
      if (/Index of\s*\/|Parent Directory|<title>\s*Directory\s*(listing|of)/i.test(body)) {
        return [{
          controlId: `EXT.WEB.DIRLIST.${port}`,
          title: "Directory listing habilitado — estrutura de arquivos exposta",
          category: "Exposição de Arquivos Sensíveis",
          severity: "medium",
          status: "open",
          affectedResource: `${baseUrl}${path}`,
          description: `O servidor retorna listagem de diretório para ${path}. Isso expõe a estrutura interna, nomes de arquivos, backups e recursos não vinculados a nenhuma página pública.`,
          rationale: "Directory listing revela arquivos de configuração, backups e scripts que o desenvolvedor assumia como não encontráveis. É frequentemente o primeiro passo de reconhecimento em ataques.",
          remediation: "Desabilite directory listing:\n- nginx: remova 'autoindex on' ou adicione 'autoindex off'\n- Apache: Options -Indexes no VirtualHost ou .htaccess\n- IIS: Desmarque 'Directory Browsing' nas configurações do site.",
          references: ["OWASP A01:2021 — Broken Access Control", "CWE-548"],
          evidence: { url: `${baseUrl}${path}` },
        }];
      }
    } catch { /* continue */ }
  }
  return [];
}

// ─── Error Page Information Disclosure ────────────────────────────────────────

const STACK_TRACE_PATTERNS = [
  /at\s+[\w$.]+\s*\([^)]+\.(js|ts|py|rb|php|java|cs|go)\s*:\d+/i,
  /Traceback\s*\(most recent call last\)/i,
  /Exception\s+in\s+thread/i,
  /Fatal error:/i,
  /Warning:\s+\w+\(\)/i,
  /\bSQLException\b|\bPDOException\b|\bMysqlError\b/i,
  /Call Stack:|call_stack|backtrace/i,
  /at\s+\w+\.(\w+)\((\w+\.java):\d+\)/i,
];

async function checkErrorDisclosure(host: string, port: number, isHttps: boolean): Promise<Check[]> {
  const proto = isHttps ? "https" : "http";
  const baseUrl = `${proto}://${host}:${port}`;
  const randomPath = `/wnraudit-probe-${Math.random().toString(36).slice(2, 10)}`;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${baseUrl}${randomPath}`, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SecurityScanner/1.0)" },
    });
    clearTimeout(t);
    if (res.status < 400 || res.status >= 600) return [];
    const body = await res.text().catch(() => "");
    const matched = STACK_TRACE_PATTERNS.find((p) => p.test(body));
    if (matched) {
      return [{
        controlId: `EXT.WEB.ERRORDISCLOSURE.${port}`,
        title: "Stack trace ou erro interno exposto em página de erro",
        category: "Information Disclosure (OWASP A05)",
        severity: "medium",
        status: "open",
        affectedResource: `${baseUrl}${randomPath}`,
        description: `A resposta de erro (HTTP ${res.status}) expõe stack trace, mensagens de exceção ou informações internas do servidor. Isso fornece ao atacante detalhes sobre tecnologias, caminhos de arquivo e possíveis vetores de ataque.`,
        rationale: "Stack traces revelam a estrutura interna da aplicação, versões de frameworks e caminhos de arquivo. Atacantes usam essas informações para customizar exploits específicos para a stack usada.",
        remediation: "1. Configure modo de produção (NODE_ENV=production, DEBUG=False, display_errors=Off).\n2. Implemente páginas de erro customizadas sem detalhes internos.\n3. Registre erros internamente (logs) sem expor ao cliente.\n4. Use handler global de exceções não tratadas.",
        references: ["OWASP A05:2021 — Security Misconfiguration", "CWE-209"],
        evidence: { url: `${baseUrl}${randomPath}`, statusCode: res.status, bodySnippet: body.substring(0, 300) },
      }];
    }
  } catch { /* connection failed */ }
  return [];
}

// ─── Subdomain Enumeration ─────────────────────────────────────────────────────

const RISKY_SUBDOMAINS = [
  "dev", "staging", "test", "beta", "qa", "uat",
  "admin", "portal", "internal", "intranet",
  "vpn", "remote", "rdp", "ssh",
  "git", "gitlab", "jenkins", "ci", "jira", "confluence",
  "api", "api-dev", "api-staging",
];

async function checkSubdomains(host: string): Promise<Check[]> {
  if (isIp(host)) return [];
  const apex = getApexDomain(host);
  const findings: Check[] = [];

  await Promise.all(
    RISKY_SUBDOMAINS.map(async (sub) => {
      const fqdn = `${sub}.${apex}`;
      if (fqdn === host || fqdn === `www.${apex}`) return;
      try {
        const result = await dns.lookup(fqdn, { all: false }).catch(() => null);
        if (!result) return;
        const addr = (result as { address: string }).address;
        findings.push({
          controlId: `EXT.SUBDOMAIN.${sub.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`,
          title: `Subdomínio sensível ativo: ${fqdn}`,
          category: "Reconhecimento / Superfície de Ataque",
          severity: "medium",
          status: "open",
          affectedResource: fqdn,
          description: `O subdomínio ${fqdn} está ativo (resolve para ${addr}). Subdomínios de desenvolvimento, CI/CD, VPN e ferramentas internas expostos na internet aumentam a superfície de ataque e frequentemente têm controles mais fracos.`,
          rationale: "Ambientes dev/staging e ferramentas de CI/CD expostos costumam ter senhas padrão, versões desatualizadas e sem MFA. São alvos prioritários em reconnaissance attacks e ataques de supply chain.",
          remediation: "1. Restrinja este subdomínio a IPs corporativos via firewall ou coloque atrás de VPN.\n2. Se não for mais necessário, remova o registro DNS.\n3. Certifique-se de que ambientes não-produção têm os mesmos controles de segurança que produção.",
          references: ["OWASP A05:2021 — Security Misconfiguration", "ISO 27001 A.8.8"],
          evidence: { subdomain: fqdn, resolvedIp: addr },
        });
      } catch { /* subdomain doesn't exist */ }
    }),
  );

  return findings;
}

// ─── Login Rate Limiting ───────────────────────────────────────────────────────

async function checkRateLimit(host: string, port: number, isHttps: boolean): Promise<Check[]> {
  const proto = isHttps ? "https" : "http";
  const baseUrl = `${proto}://${host}:${port}`;

  for (const loginPath of ["/login", "/signin", "/auth/login", "/admin/login", "/wp-login.php"]) {
    let html = "";
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(`${baseUrl}${loginPath}`, {
        method: "GET", redirect: "follow", signal: ctrl.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SecurityScanner/1.0)" },
      });
      clearTimeout(t);
      if (!res.ok) continue;
      html = await res.text().catch(() => "");
    } catch { continue; }

    if (!/<input\b[^>]+type=["']password["']/i.test(html)) continue;

    const formMatch = /<form\b([^>]*)>([\s\S]*?)<\/form>/i.exec(html);
    if (!formMatch) continue;
    const formAttrs = formMatch[1];
    const formBody = formMatch[2];
    if (!/<input\b[^>]+type=["']password["']/i.test(formBody)) continue;

    const actionAttr = /\baction=["']([^"']*?)["']/i.exec(formAttrs);
    let action = actionAttr ? actionAttr[1] : loginPath;
    if (!action || action === "#") action = loginPath;
    if (action.startsWith("/")) action = `${baseUrl}${action}`;
    else if (!action.startsWith("http")) action = `${baseUrl}/${action}`;

    const methodAttr = /\bmethod=["']([^"']+)["']/i.exec(formAttrs);
    const method = (methodAttr ? methodAttr[1] : "POST").toUpperCase();

    const statuses: number[] = [];
    let gotRateLimited = false;

    for (let i = 0; i < 7; i++) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 4000);
        const formData = new URLSearchParams({
          username: `ratelimitprobe_wnr_${i}`,
          email: `ratelimitprobe${i}@wnraudit.invalid`,
          password: `wrongpassword_probe_${i}`,
        });
        const res = await fetch(action, {
          method,
          redirect: "manual",
          signal: ctrl.signal,
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0 (compatible; SecurityScanner/1.0)" },
          body: formData.toString(),
        });
        clearTimeout(t);
        statuses.push(res.status);
        if (res.status === 429 || res.status === 423 || res.headers.get("retry-after")) {
          gotRateLimited = true;
          break;
        }
      } catch { /* continue */ }
    }

    if (!gotRateLimited && statuses.filter((s) => s < 500).length >= 5) {
      return [{
        controlId: `EXT.LOGIN.RATELIMIT.${port}`,
        title: "Formulário de login sem rate limiting — vulnerável a força bruta",
        category: "Autenticação (OWASP A07)",
        severity: "medium",
        status: "open",
        affectedResource: action,
        description: `O formulário de login em ${loginPath} não implementa bloqueio após múltiplas tentativas falhas. 7 tentativas consecutivas com credenciais inválidas foram aceitas sem restrição (respostas: ${statuses.join(", ")}). Ataques de força bruta e credential stuffing são triviais.`,
        rationale: "Sem rate limiting, um atacante pode testar milhares de senhas por minuto via automação. Especialmente crítico quando combinado com listas de senhas vazadas (credential stuffing) e ausência de MFA.",
        remediation: "1. Bloqueio temporário após 5 tentativas falhas (ex: 15 minutos por IP).\n2. CAPTCHA após 3 tentativas.\n3. Account lockout com notificação ao usuário.\n4. Registre e alerte IPs com múltiplas tentativas.\n5. Implemente MFA para eliminar o risco mesmo com senha comprometida.",
        references: ["OWASP A07:2021 — Authentication Failures", "CWE-307", "ISO 27001 A.8.5"],
        evidence: { loginPath, action, attemptsCount: 7, responseStatuses: statuses },
      }];
    }

    break;
  }
  return [];
}

// ─── XSS em Formulários POST ──────────────────────────────────────────────────

async function checkXSSInForms(host: string, port: number, isHttps: boolean): Promise<Check[]> {
  const proto = isHttps ? "https" : "http";
  const baseUrl = `${proto}://${host}:${port}`;
  const XSS_FORM_PAYLOADS = [
    { payload: "<script>alert(1)</script>", indicator: "<script>alert(1)" },
    { payload: '"><img src=x onerror=alert(1)>', indicator: "onerror=alert(1)" },
    { payload: "'><svg onload=alert(1)>", indicator: "onload=alert(1)" },
  ];
  const pathsToTest = ["/", "/search", "/contact", "/comment", "/feedback", "/register", "/signup", "/busca", "/pesquisa"];
  const testedActions = new Set<string>();

  for (const path of pathsToTest) {
    let html = "";
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(`${baseUrl}${path}`, {
        method: "GET", redirect: "follow", signal: ctrl.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SecurityScanner/1.0)" },
      });
      clearTimeout(t);
      if (!res.ok) continue;
      html = await res.text().catch(() => "");
    } catch { continue; }

    const formRegex = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
    let formMatch;
    while ((formMatch = formRegex.exec(html)) !== null) {
      const formAttrs = formMatch[1];
      const formBody = formMatch[2];
      // Skip login forms (already covered by checkLoginForms)
      if (/<input\b[^>]+type=["']password["']/i.test(formBody)) continue;

      const actionAttr = /\baction=["']([^"']*?)["']/i.exec(formAttrs);
      let action = actionAttr ? actionAttr[1] : path;
      if (!action || action === "#") action = path;
      if (action.startsWith("/")) action = `${baseUrl}${action}`;
      else if (!action.startsWith("http")) action = `${baseUrl}/${action}`;
      if (testedActions.has(action)) continue;
      testedActions.add(action);

      const methodAttr = /\bmethod=["']([^"']+)["']/i.exec(formAttrs);
      const method = (methodAttr ? methodAttr[1] : "GET").toUpperCase();
      if (method !== "POST" && method !== "GET") continue;

      const textFields: string[] = [];
      const inputRegex = /<input\b[^>]+>/gi;
      let inp;
      while ((inp = inputRegex.exec(formBody)) !== null) {
        const typeM = /\btype=["']([^"']+)["']/i.exec(inp[0]);
        const type = (typeM ? typeM[1] : "text").toLowerCase();
        if (!["text", "search", "email", "tel", "url"].includes(type)) continue;
        const nameM = /\bname=["']([^"']+)["']/i.exec(inp[0]);
        if (nameM) textFields.push(nameM[1]);
      }
      // Also check textarea
      const textareaRegex = /<textarea\b[^>]*name=["']([^"']+)["'][^>]*>/gi;
      let ta;
      while ((ta = textareaRegex.exec(formBody)) !== null) {
        textFields.push(ta[1]);
      }
      if (textFields.length === 0) continue;

      for (const field of textFields.slice(0, 3)) {
        for (const { payload, indicator } of XSS_FORM_PAYLOADS) {
          try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 5000);
            const formData = new URLSearchParams();
            formData.set(field, payload);
            const res = await fetch(method === "GET" ? `${action}?${formData.toString()}` : action, {
              method,
              redirect: "manual",
              signal: ctrl.signal,
              headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0 (compatible; SecurityScanner/1.0)" },
              body: method === "POST" ? formData.toString() : undefined,
            });
            clearTimeout(t);
            const body = await res.text().catch(() => "");
            if (body.includes(indicator)) {
              return [{
                controlId: `EXT.WEB.XSS.FORM.${port}`,
                title: "XSS refletido em campo de formulário (não-login)",
                category: "XSS (OWASP A03)",
                severity: "high",
                status: "open",
                affectedResource: action,
                description: `O campo '${field}' do formulário em ${path} reflete o payload XSS '${indicator}' sem sanitização na resposta ${method}. Scripts maliciosos podem ser executados no contexto do domínio.`,
                rationale: "XSS em formulários permite que atacantes construam páginas que automaticamente submetem payloads maliciosos, roubando sessões, credenciais ou realizando ações em nome do usuário.",
                remediation: "1. Encode todos os dados dinâmicos para o contexto HTML antes de renderizar.\n2. Implemente Content-Security-Policy.\n3. Use frameworks com encoding automático (React, Angular, Vue).\n4. Valide e sanitize entradas no servidor (nunca confie no cliente).",
                references: ["OWASP A03:2021 — XSS", "CWE-79"],
                evidence: { action, field, payload, indicator, method },
              }];
            }
          } catch { /* continue */ }
        }
      }
    }
  }
  return [];
}

async function runScanForHost(host: string): Promise<ExternalScanResult> {
  const findings: Check[] = [];
  const openPortsList: Array<{ port: number; service: string; banner: string | null }> = [];
  let checksRan = 0;

  // Port scan with concurrency limit
  checksRan += COMMON_PORTS.length;
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

  // DNS checks (only meaningful for domain names)
  if (net.isIP(host) === 0) checksRan += 4; // SPF, DMARC, DKIM, MTA-STS
  findings.push(...(await dnsChecks(host)));

  // Passive web checks (exposed paths + CORS) on standard ports + any other open web ports
  const webPortSet = new Set<number>([80, 443]);
  for (const p of openPortsList) {
    if (HTTP_PORTS.has(p.port) || HTTPS_PORTS.has(p.port)) webPortSet.add(p.port);
  }
  for (const port of webPortSet) {
    checksRan += EXPOSED_PATHS.length; // exposed path probes
    checksRan += 1;                    // CORS check
    checksRan += SECURITY_HEADERS.length; // header checks
    if (port === 80) checksRan += 1;  // HTTP→HTTPS redirect check
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
    checksRan += openWebPorts.length * 2; // SQLi + XSS per web port
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
  if (openPortsList.some((p) => p.port === 21)) checksRan += 1; // FTP brute
  checksRan += openWebPorts.length; // HTTP Basic per web port
  findings.push(...(await checkBruteForce(host, openPortsList)));

  // Supply chain: dependency file exposure + SRI check
  const supplyChainTasks: Promise<Check[]>[] = [];
  for (const port of webPortSet) {
    const isHttps = HTTPS_PORTS.has(port);
    checksRan += SUPPLY_CHAIN_PATHS.length + 1; // dep files + SRI
    supplyChainTasks.push(checkSupplyChain(host, port, isHttps));
  }
  const supplyChainResults = await Promise.all(supplyChainTasks);
  for (const r of supplyChainResults) findings.push(...r);

  // Login form testing: CSRF + form SQLi + default creds on form
  const loginFormTasks: Promise<Check[]>[] = [];
  for (const port of webPortSet) {
    const isHttps = HTTPS_PORTS.has(port);
    checksRan += LOGIN_PATHS.length * 3; // CSRF + SQLi + default creds per path
    loginFormTasks.push(checkLoginForms(host, port, isHttps));
  }
  const loginFormResults = await Promise.all(loginFormTasks);
  for (const r of loginFormResults) findings.push(...r);

  // HTTP dangerous methods (TRACE, PUT, OPTIONS enumeration)
  const httpMethodTasks: Promise<Check[]>[] = [];
  for (const port of webPortSet) {
    const isHttps = HTTPS_PORTS.has(port);
    checksRan += 3; // TRACE + PUT + OPTIONS
    httpMethodTasks.push(checkHttpMethods(host, port, isHttps));
  }
  const httpMethodResults = await Promise.all(httpMethodTasks);
  for (const r of httpMethodResults) findings.push(...r);

  // Open Redirect on web ports
  const openRedirectTasks: Promise<Check[]>[] = [];
  for (const port of webPortSet) {
    const isHttps = HTTPS_PORTS.has(port);
    checksRan += REDIRECT_PARAMS.length * REDIRECT_PROBE_PATHS.length;
    openRedirectTasks.push(checkOpenRedirect(host, port, isHttps));
  }
  const openRedirectResults = await Promise.all(openRedirectTasks);
  for (const r of openRedirectResults) findings.push(...r);

  // Cookie security flags
  const cookieTasks: Promise<Check[]>[] = [];
  for (const port of webPortSet) {
    const isHttps = HTTPS_PORTS.has(port);
    checksRan += 1;
    cookieTasks.push(checkCookieSecurity(host, port, isHttps));
  }
  const cookieResults = await Promise.all(cookieTasks);
  for (const r of cookieResults) findings.push(...r);

  // Directory listing check
  const dirListTasks: Promise<Check[]>[] = [];
  for (const port of webPortSet) {
    const isHttps = HTTPS_PORTS.has(port);
    checksRan += DIR_LISTING_PATHS.length;
    dirListTasks.push(checkDirectoryListing(host, port, isHttps));
  }
  const dirListResults = await Promise.all(dirListTasks);
  for (const r of dirListResults) findings.push(...r);

  // Error page information disclosure
  const errorDisclosureTasks: Promise<Check[]>[] = [];
  for (const port of webPortSet) {
    const isHttps = HTTPS_PORTS.has(port);
    checksRan += 1;
    errorDisclosureTasks.push(checkErrorDisclosure(host, port, isHttps));
  }
  const errorDisclosureResults = await Promise.all(errorDisclosureTasks);
  for (const r of errorDisclosureResults) findings.push(...r);

  // Subdomain enumeration (DNS — only for domain names)
  if (!isIp(host)) {
    checksRan += RISKY_SUBDOMAINS.length;
    findings.push(...(await checkSubdomains(host)));
  }

  // Login rate limiting check
  const rateLimitTasks: Promise<Check[]>[] = [];
  for (const port of webPortSet) {
    const isHttps = HTTPS_PORTS.has(port);
    checksRan += 7; // 7 rapid attempts
    rateLimitTasks.push(checkRateLimit(host, port, isHttps));
  }
  const rateLimitResults = await Promise.all(rateLimitTasks);
  for (const r of rateLimitResults) findings.push(...r);

  // XSS in non-login POST forms
  const xssFormTasks: Promise<Check[]>[] = [];
  for (const port of webPortSet) {
    const isHttps = HTTPS_PORTS.has(port);
    checksRan += 9 * 3; // paths * payloads
    xssFormTasks.push(checkXSSInForms(host, port, isHttps));
  }
  const xssFormResults = await Promise.all(xssFormTasks);
  for (const r of xssFormResults) findings.push(...r);

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
      total: checksRan,
      passed: checksRan - findings.length,
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
      passedChecks: result.totals.passed,
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
