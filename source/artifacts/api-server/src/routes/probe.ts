import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";
import {
  db,
  probeRegistrationsTable,
  probeScanJobsTable,
  deviceScansTable,
  deviceFindingsTable,
  customersTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateProbeToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

async function resolveProbeFromToken(req: Request): Promise<typeof probeRegistrationsTable.$inferSelect | null> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  const [probe] = await db
    .select()
    .from(probeRegistrationsTable)
    .where(eq(probeRegistrationsTable.probeToken, token))
    .limit(1);
  return probe ?? null;
}

// Mark probes as offline if not seen in 5 minutes
async function markStaleProbesOffline(): Promise<void> {
  const cutoff = new Date(Date.now() - 5 * 60 * 1000);
  await db
    .update(probeRegistrationsTable)
    .set({ status: "offline", updatedAt: new Date() })
    .where(
      and(
        eq(probeRegistrationsTable.status, "online"),
        lt(probeRegistrationsTable.lastSeenAt, cutoff),
      ),
    );
}

// ─── Public routes (Bearer probe token, no Clerk) ─────────────────────────────

// POST /probe/checkin — probe heartbeat + registration
// Returns pending scan jobs for this probe
router.post("/probe/checkin", async (req: Request, res: Response): Promise<void> => {
  const probe = await resolveProbeFromToken(req);
  if (!probe) {
    res.status(401).json({ error: "Token inválido" });
    return;
  }

  const body = z.object({
    hostname: z.string().optional(),
    ipAddress: z.string().optional(),
    os: z.string().optional(),
    agentVersion: z.string().optional(),
    probeMachineId: z.string().optional(),
  }).safeParse(req.body);

  const updates: Record<string, unknown> = {
    status: "online",
    lastSeenAt: new Date(),
    updatedAt: new Date(),
  };
  if (body.success) {
    if (body.data.hostname) updates.hostname = body.data.hostname;
    if (body.data.ipAddress) updates.ipAddress = body.data.ipAddress;
    if (body.data.os) updates.os = body.data.os;
    if (body.data.agentVersion) updates.agentVersion = body.data.agentVersion;
    if (body.data.probeMachineId && !probe.probeMachineId) {
      updates.probeMachineId = body.data.probeMachineId;
    }
  }

  await db
    .update(probeRegistrationsTable)
    .set(updates)
    .where(eq(probeRegistrationsTable.id, probe.id));

  // Fetch queued jobs for this probe
  const pendingJobs = await db
    .select({
      jobId: probeScanJobsTable.id,
      targetIp: probeScanJobsTable.targetIp,
      targetHostname: probeScanJobsTable.targetHostname,
      deviceType: probeScanJobsTable.deviceType,
      deviceScanId: probeScanJobsTable.deviceScanId,
    })
    .from(probeScanJobsTable)
    .where(
      and(
        eq(probeScanJobsTable.probeId, probe.id),
        eq(probeScanJobsTable.status, "queued"),
      ),
    );

  if (pendingJobs.length > 0) {
    await db
      .update(probeScanJobsTable)
      .set({ status: "running", pickedUpAt: new Date() })
      .where(
        and(
          eq(probeScanJobsTable.probeId, probe.id),
          eq(probeScanJobsTable.status, "queued"),
        ),
      );
  }

  res.json({ probeId: probe.id, pendingJobs });
});

// POST /probe/results/:jobId — probe submits scan findings
router.post("/probe/results/:jobId", async (req: Request, res: Response): Promise<void> => {
  const probe = await resolveProbeFromToken(req);
  if (!probe) {
    res.status(401).json({ error: "Token inválido" });
    return;
  }

  const [job] = await db
    .select()
    .from(probeScanJobsTable)
    .where(
      and(
        eq(probeScanJobsTable.id, req.params.jobId as string),
        eq(probeScanJobsTable.probeId, probe.id),
      ),
    )
    .limit(1);

  if (!job) {
    res.status(404).json({ error: "Job não encontrado" });
    return;
  }

  const parsed = z.object({
    status: z.enum(["completed", "failed"]),
    findings: z.array(z.object({
      controlId: z.string(),
      title: z.string(),
      category: z.string(),
      severity: z.enum(["critical", "high", "medium", "low"]),
      description: z.string(),
      rationale: z.string(),
      remediation: z.string(),
      references: z.array(z.string()).default([]),
      affectedResource: z.string().optional(),
      evidence: z.record(z.unknown()).optional(),
    })).default([]),
    totalChecks: z.number().int().default(0),
    passedChecks: z.number().int().default(0),
  }).safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { findings, totalChecks, passedChecks } = parsed.data;

  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity]++;

  // Insert findings
  if (findings.length > 0) {
    await db.insert(deviceFindingsTable).values(
      findings.map((f) => ({
        deviceScanId: job.deviceScanId,
        controlId: f.controlId,
        title: f.title,
        category: f.category,
        severity: f.severity as "critical" | "high" | "medium" | "low",
        status: "open" as const,
        affectedResource: f.affectedResource ?? null,
        description: f.description,
        rationale: f.rationale,
        remediation: f.remediation,
        references: f.references,
        evidence: f.evidence ?? null,
      })),
    );
  }

  // Update device scan record
  await db
    .update(deviceScansTable)
    .set({
      status: parsed.data.status === "completed" ? "completed" : "failed",
      completedAt: new Date(),
      totalChecks,
      passedChecks,
      failedChecks: findings.length,
      criticalCount: counts.critical,
      highCount: counts.high,
      mediumCount: counts.medium,
      lowCount: counts.low,
    })
    .where(eq(deviceScansTable.id, job.deviceScanId));

  // Update job
  await db
    .update(probeScanJobsTable)
    .set({ status: parsed.data.status, completedAt: new Date() })
    .where(eq(probeScanJobsTable.id, job.id));

  logger.info({ probeId: probe.id, jobId: job.id, findings: findings.length }, "Probe scan results received");
  res.json({ ok: true });
});

// ─── Authenticated management routes (Clerk) ──────────────────────────────────

// GET /probes — list all probes for customer
router.get("/probes", requireAuth, async (req, res): Promise<void> => {
  await markStaleProbesOffline();
  const customer = req.customer!;
  const probes = await db
    .select({
      id: probeRegistrationsTable.id,
      displayName: probeRegistrationsTable.displayName,
      hostname: probeRegistrationsTable.hostname,
      ipAddress: probeRegistrationsTable.ipAddress,
      os: probeRegistrationsTable.os,
      agentVersion: probeRegistrationsTable.agentVersion,
      status: probeRegistrationsTable.status,
      lastSeenAt: probeRegistrationsTable.lastSeenAt,
      createdAt: probeRegistrationsTable.createdAt,
    })
    .from(probeRegistrationsTable)
    .where(eq(probeRegistrationsTable.customerId, customer.id))
    .orderBy(desc(probeRegistrationsTable.createdAt));
  res.json(probes);
});

// POST /probes — create probe registration + return token (shown once)
router.post("/probes", requireAuth, async (req, res): Promise<void> => {
  const parsed = z.object({
    displayName: z.string().min(1),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const customer = req.customer!;
  const probeToken = generateProbeToken();

  const [created] = await db
    .insert(probeRegistrationsTable)
    .values({
      customerId: customer.id,
      displayName: parsed.data.displayName,
      probeToken,
      status: "pending",
    })
    .returning();

  // Return the raw token once — not stored in plaintext after this
  res.status(201).json({ ...created, probeToken });
});

// DELETE /probes/:probeId — remove probe
router.delete("/probes/:probeId", requireAuth, async (req, res): Promise<void> => {
  const customer = req.customer!;
  const [deleted] = await db
    .delete(probeRegistrationsTable)
    .where(
      and(
        eq(probeRegistrationsTable.id, req.params.probeId as string),
        eq(probeRegistrationsTable.customerId, customer.id),
      ),
    )
    .returning({ id: probeRegistrationsTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Probe não encontrado" });
    return;
  }
  res.sendStatus(204);
});

// GET /probes/:probeId/download — generate installer PowerShell script with embedded token
router.get("/probes/:probeId/download", requireAuth, async (req, res): Promise<void> => {
  const customer = req.customer!;
  const [probe] = await db
    .select()
    .from(probeRegistrationsTable)
    .where(
      and(
        eq(probeRegistrationsTable.id, req.params.probeId as string),
        eq(probeRegistrationsTable.customerId, customer.id),
      ),
    )
    .limit(1);

  if (!probe) {
    res.status(404).json({ error: "Probe não encontrado" });
    return;
  }

  const apiUrl = process.env.FRONTEND_BASE_URL
    ? process.env.FRONTEND_BASE_URL.replace(/\/wnraudit\/?$/, "")
    : "https://wnrtecnologia.com.br";

  const script = generateProbeScript(probe.probeToken, apiUrl, probe.displayName);
  const filename = `Instalar_WNRAudit_Probe_${probe.displayName.replace(/\s+/g, "_")}.ps1`;

  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(script);
});

// ─── Probe PowerShell script generator ───────────────────────────────────────

function generateProbeScript(token: string, apiUrl: string, displayName: string): string {
  return (`#Requires -Version 2.0
# WNR Audit Security Probe v1.0
# Cliente: ${displayName}
# Gerado em: ${new Date().toISOString()}
# Isolamento: instalacao em C:\\Program Files\\WNRAudit-Probe\\ — nao conflita com WinnerRMM-Legacy

param(
    [switch]$Uninstall
)

$PROBE_TOKEN   = "${token}"
$API_URL       = "${apiUrl}/wnraudit/api"
$INSTALL_DIR   = "C:\\Program Files\\WNRAudit-Probe"
$AGENT_SCRIPT  = Join-Path $INSTALL_DIR "probe_agent.ps1"
$LOG_FILE      = Join-Path $INSTALL_DIR "probe_agent.log"
$TASK_AGENT    = "WNRAuditProbeAgent"
$TASK_WATCHDOG = "WNRAuditProbeWatchdog"
$WATCHDOG_SCRIPT = Join-Path $INSTALL_DIR "probe_watchdog.ps1"

function Write-Log {
    param([string]$Msg, [string]$Level = "INFO")
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts][$Level] $Msg"
    Add-Content -Path $LOG_FILE -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
    Write-Host $line
}

# ─── Uninstall ────────────────────────────────────────────────────────────────
if ($Uninstall) {
    Write-Host "Removendo WNR Audit Security Probe..."
    schtasks /Delete /TN $TASK_AGENT    /F 2>$null | Out-Null
    schtasks /Delete /TN $TASK_WATCHDOG /F 2>$null | Out-Null
    if (Test-Path $INSTALL_DIR) { Remove-Item $INSTALL_DIR -Recurse -Force }
    Write-Host "Probe removido com sucesso."
    exit 0
}

# ─── Install ──────────────────────────────────────────────────────────────────
Write-Host "Instalando WNR Audit Security Probe para: ${displayName}"

if (-not (Test-Path $INSTALL_DIR)) { New-Item -ItemType Directory -Path $INSTALL_DIR -Force | Out-Null }

# Protect directory: SYSTEM + Admins full, Users read-only
$acl = Get-Acl $INSTALL_DIR
$acl.SetAccessRuleProtection($true, $false)
$rule1 = New-Object System.Security.AccessControl.FileSystemAccessRule("SYSTEM","FullControl","Allow")
$rule2 = New-Object System.Security.AccessControl.FileSystemAccessRule("Administrators","FullControl","Allow")
$rule3 = New-Object System.Security.AccessControl.FileSystemAccessRule("Users","ReadAndExecute","Allow")
$acl.SetAccessRule($rule1); $acl.SetAccessRule($rule2); $acl.SetAccessRule($rule3)
Set-Acl -Path $INSTALL_DIR -AclObject $acl -ErrorAction SilentlyContinue

# Store token encrypted with DPAPI (LocalMachine scope)
$tokenBytes = [System.Text.Encoding]::UTF8.GetBytes($PROBE_TOKEN)
$encrypted  = [System.Security.Cryptography.ProtectedData]::Protect(
    $tokenBytes, $null,
    [System.Security.Cryptography.DataProtectionScope]::LocalMachine
)
$secureDir = Join-Path $INSTALL_DIR "secure"
if (-not (Test-Path $secureDir)) { New-Item -ItemType Directory -Path $secureDir -Force | Out-Null }
[System.IO.File]::WriteAllBytes((Join-Path $secureDir "probe_token.dat"), $encrypted)

# Write agent script
$agentCode = Get-AgentScript -ApiUrl $API_URL -InstallDir $INSTALL_DIR -LogFile $LOG_FILE
Set-Content -Path $AGENT_SCRIPT -Value $agentCode -Encoding UTF8

# Write watchdog script
$watchdogCode = Get-WatchdogScript -InstallDir $INSTALL_DIR -AgentScript $AGENT_SCRIPT -TaskName $TASK_AGENT -LogFile $LOG_FILE
Set-Content -Path $WATCHDOG_SCRIPT -Value $watchdogCode -Encoding UTF8

# Create scheduled tasks
$psExe = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
$agentArgs   = "-ExecutionPolicy Bypass -NonInteractive -WindowStyle Hidden -File [[BT]]"$AGENT_SCRIPT[[BT]]""
$watchdogArgs = "-ExecutionPolicy Bypass -NonInteractive -WindowStyle Hidden -File [[BT]]"$WATCHDOG_SCRIPT[[BT]]""

schtasks /Create /TN $TASK_AGENT /TR "$psExe $agentArgs" /SC ONSTART /RU SYSTEM /RL HIGHEST /F 2>&1 | Out-Null
schtasks /Create /TN $TASK_WATCHDOG /TR "$psExe $watchdogArgs" /SC MINUTE /MO 5 /RU SYSTEM /RL HIGHEST /F 2>&1 | Out-Null

# Start agent now
Start-ScheduledTask -TaskName $TASK_AGENT -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Probe instalado com sucesso!"
Write-Host "Diretorio: $INSTALL_DIR"
Write-Host "Tarefa: $TASK_AGENT (executando como SYSTEM)"
Write-Host "Log: $LOG_FILE"

function Get-AgentScript {
    param([string]$ApiUrl, [string]$InstallDir, [string]$LogFile)
    return @'
#Requires -Version 2.0
# WNR Audit Security Probe — Agent
Add-Type -AssemblyName System.Security

$API_URL     = "API_URL_PLACEHOLDER"
$INSTALL_DIR = "INSTALL_DIR_PLACEHOLDER"
$LOG_FILE    = "LOG_FILE_PLACEHOLDER"
$HEARTBEAT   = Join-Path $INSTALL_DIR "health\\heartbeat.json"
$SECURE_DIR  = Join-Path $INSTALL_DIR "secure"
$VERSION     = "1.0"
$CHECKIN_INTERVAL = 60   # seconds
$RECYCLE_HOURS    = 8    # restart agent after N hours

function Write-Log {
    param([string]$Msg, [string]$Level = "INFO")
    $ts   = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts][$Level] $Msg"
    Add-Content -Path $LOG_FILE -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
}

function Write-Heartbeat {
    $dir = Split-Path $HEARTBEAT
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    @{ ts = (Get-Date -Format "o"); pid = $PID } | ConvertTo-Json | Set-Content -Path $HEARTBEAT -Encoding UTF8
}

function Get-ProbeToken {
    $dat = Join-Path $SECURE_DIR "probe_token.dat"
    $encrypted = [System.IO.File]::ReadAllBytes($dat)
    $bytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
        $encrypted, $null,
        [System.Security.Cryptography.DataProtectionScope]::LocalMachine
    )
    return [System.Text.Encoding]::UTF8.GetString($bytes)
}

function Get-LocalIP {
    try {
        $adapters = Get-WmiObject Win32_NetworkAdapterConfiguration -Filter "IPEnabled=True" -ErrorAction Stop
        foreach ($a in $adapters) {
            foreach ($ip in $a.IPAddress) {
                if ($ip -match "^\d+\.\d+\.\d+\.\d+$" -and $ip -notmatch "^127\.") { return $ip }
            }
        }
    } catch {}
    return "unknown"
}

function Get-MachineId {
    $idFile = Join-Path $INSTALL_DIR "probe_machine_id"
    if (Test-Path $idFile) { return (Get-Content $idFile -Raw).Trim() }
    $id = [System.Guid]::NewGuid().ToString()
    Set-Content -Path $idFile -Value $id -Encoding UTF8
    return $id
}

function Invoke-Api {
    param([string]$Method, [string]$Path, [hashtable]$Body = @{})
    try {
        $token   = Get-ProbeToken
        $url     = "$API_URL$Path"
        $json    = $Body | ConvertTo-Json -Depth 10
        $bytes   = [System.Text.Encoding]::UTF8.GetBytes($json)
        $req     = [System.Net.HttpWebRequest]::Create($url)
        $req.Method        = $Method
        $req.ContentType   = "application/json"
        $req.ContentLength = $bytes.Length
        $req.Timeout       = 30000
        $req.UserAgent     = "WNRAudit-Probe/$VERSION"
        $req.Headers.Add("Authorization", "Bearer $token")
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
        $stream = $req.GetRequestStream()
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Close()
        $resp   = $req.GetResponse()
        $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $result = $reader.ReadToEnd()
        $reader.Close(); $resp.Close()
        return $result | ConvertFrom-Json
    } catch {
        Write-Log "Invoke-Api $Method $Path failed: $_" "WARN"
        return $null
    }
}

function Test-TcpPort {
    param([string]$Target, [int]$Port, [int]$TimeoutMs = 2000)
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $ar  = $tcp.BeginConnect($Target, $Port, $null, $null)
        $ok  = $ar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)
        if ($ok -and $tcp.Connected) { $tcp.EndConnect($ar); $tcp.Close(); return $true }
        $tcp.Close()
    } catch {}
    return $false
}

function Get-Banner {
    param([string]$Target, [int]$Port, [int]$TimeoutMs = 3000)
    try {
        $tcp    = New-Object System.Net.Sockets.TcpClient
        $ar     = $tcp.BeginConnect($Target, $Port, $null, $null)
        if (-not $ar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) { $tcp.Close(); return $null }
        $stream = $tcp.GetStream()
        $stream.ReadTimeout = $TimeoutMs
        $buf  = New-Object byte[] 512
        $read = $stream.Read($buf, 0, 512)
        $tcp.Close()
        return [System.Text.Encoding]::ASCII.GetString($buf, 0, $read).Trim()
    } catch { return $null }
}

function Get-HttpHeaders {
    param([string]$Url, [int]$TimeoutMs = 5000)
    try {
        $req = [System.Net.HttpWebRequest]::Create($Url)
        $req.Timeout = $TimeoutMs
        $req.AllowAutoRedirect = $false
        $req.UserAgent = "WNRAudit-Probe/$VERSION"
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
        $resp = $req.GetResponse()
        $h = @{}
        foreach ($k in $resp.Headers.AllKeys) { $h[$k] = $resp.Headers[$k] }
        $h["__StatusCode"] = [int]$resp.StatusCode
        $resp.Close()
        return $h
    } catch [System.Net.WebException] {
        if ($_.Exception.Response) {
            $h = @{}
            foreach ($k in $_.Exception.Response.Headers.AllKeys) { $h[$k] = $_.Exception.Response.Headers[$k] }
            $h["__StatusCode"] = [int]$_.Exception.Response.StatusCode
            $_.Exception.Response.Close()
            return $h
        }
        return @{}
    } catch { return @{} }
}

function Invoke-ProbeNetworkScan {
    param([string]$TargetIp, [string]$DeviceType)

    $findings = @()
    $totalChecks = 0
    $passedChecks = 0

    # ─── Port scan: critical service ports ───────────────────────────────────
    $PORTS_TO_SCAN = @(
        21,    # FTP
        22,    # SSH
        23,    # Telnet
        25,    # SMTP
        53,    # DNS
        80,    # HTTP
        110,   # POP3
        111,   # RPC
        135,   # MS-RPC
        139,   # NetBIOS
        143,   # IMAP
        161,   # SNMP
        389,   # LDAP
        443,   # HTTPS
        445,   # SMB
        512,513,514, # r-services (rsh/rexec/rlogin)
        1433,  # MSSQL
        1521,  # Oracle
        2049,  # NFS
        3306,  # MySQL
        3389,  # RDP
        4444,  # Metasploit default
        5432,  # PostgreSQL
        5900,  # VNC
        5985,5986, # WinRM
        6379,  # Redis
        8080,8443,8888, # Alt HTTP
        9200,  # Elasticsearch
        27017  # MongoDB
    )

    $openPorts = @()
    foreach ($port in $PORTS_TO_SCAN) {
        if (Test-TcpPort -Target $TargetIp -Port $port -TimeoutMs 1500) {
            $openPorts += $port
        }
    }

    # ─── Check: Telnet exposto ────────────────────────────────────────────────
    $totalChecks++
    if ($openPorts -contains 23) {
        $findings += @{
            controlId = "NET.1.1"; title = "Telnet exposto (porta 23)"; category = "Protocolos Inseguros"
            severity = "critical"
            description = "O servico Telnet esta ativo em $TargetIp[[BT]]:23. Telnet transmite credenciais e dados em texto claro, permitindo interceptacao trivial."
            rationale = "Telnet e considerado obsoleto desde 1995. Qualquer atacante na mesma rede pode capturar sessoes completas com ferramentas como Wireshark."
            remediation = "Desabilite o servico Telnet imediatamente. Utilize SSH para acesso remoto seguro. No Windows: Services.msc → Telnet → Desabilitado. No Linux: systemctl disable telnetd."
            references = @("NIST SP 800-115","CIS Benchmark — Network Devices","CVE-1999-0619")
            affectedResource = "$TargetIp[[BT]]:23"
            evidence = @{ port = 23; open = $true }
        }
    } else { $passedChecks++ }

    # ─── Check: SSH versao antiga ─────────────────────────────────────────────
    $totalChecks++
    if ($openPorts -contains 22) {
        $banner = Get-Banner -Target $TargetIp -Port 22 -TimeoutMs 3000
        if ($banner -and $banner -match "SSH-1\.") {
            $findings += @{
                controlId = "NET.1.2"; title = "SSHv1 detectado (inseguro)"; category = "Protocolos Inseguros"
                severity = "critical"
                description = "O servidor SSH em $TargetIp[[BT]]:22 suporta protocolo SSHv1, que possui vulnerabilidades criptograficas graves incluindo ataques man-in-the-middle."
                rationale = "SSHv1 tem falhas fundamentais no protocolo de autenticacao e no CRC-32 compensation attack. Foi depreciado em 2006 (RFC 4253)."
                remediation = "Edite /etc/ssh/sshd_config e defina 'Protocol 2'. Reinicie o servico SSH. Versao detectada: $banner"
                references = @("CVE-2001-0361","RFC 4253","CIS Linux Benchmark — 5.2.2")
                affectedResource = "$TargetIp[[BT]]:22"
                evidence = @{ port = 22; banner = $banner }
            }
        } else { $passedChecks++ }
    } else { $passedChecks++ }

    # ─── Check: RDP sem NLA ───────────────────────────────────────────────────
    $totalChecks++
    if ($openPorts -contains 3389) {
        # Try to detect NLA requirement via TLS negotiation
        $nlaMissing = $false
        try {
            $tcp = New-Object System.Net.Sockets.TcpClient($TargetIp, 3389)
            $stream = $tcp.GetStream()
            # Send RDP negotiation request (TPKT + X.224)
            $rdpNego = [byte[]](0x03,0x00,0x00,0x13,0x0E,0xE0,0x00,0x00,0x00,0x00,0x00,0x01,0x00,0x08,0x00,0x03,0x00,0x00,0x00)
            $stream.Write($rdpNego, 0, $rdpNego.Length)
            $stream.ReadTimeout = 3000
            $buf = New-Object byte[] 64
            $read = $stream.Read($buf, 0, 64)
            # If response lacks CredSSP (type 0x03 at offset 15), NLA may not be required
            if ($read -gt 15 -and $buf[15] -ne 0x03) { $nlaMissing = $true }
            $tcp.Close()
        } catch { $nlaMissing = $false }

        if ($nlaMissing) {
            $findings += @{
                controlId = "NET.1.3"; title = "RDP exposto sem NLA (Network Level Authentication)"; category = "Exposicao de Acesso Remoto"
                severity = "high"
                description = "RDP em $TargetIp[[BT]]:3389 esta acessivel sem autenticacao NLA, expondo a tela de login diretamente a ataques de forca bruta e exploits pre-autenticacao."
                rationale = "Sem NLA, ataques como BlueKeep (CVE-2019-0708) e DejaBlue operam pre-autenticacao. NLA exige credenciais antes de estabelecer sessao grafica."
                remediation = "Ative NLA: Painel de Controle → Sistema → Configuracoes remotas → Permitir conexoes somente com Autenticacao em Nivel de Rede. Considere tambem VPN + RDP."
                references = @("CVE-2019-0708 (BlueKeep)","MS-TS Security","CIS Windows Server Benchmark — 18.9.65.2")
                affectedResource = "$TargetIp[[BT]]:3389"
                evidence = @{ port = 3389; nlaDetected = $false }
            }
        } else {
            $findings += @{
                controlId = "NET.1.3b"; title = "RDP exposto publicamente na rede"; category = "Exposicao de Acesso Remoto"
                severity = "medium"
                description = "RDP em $TargetIp[[BT]]:3389 esta acessivel na rede. Mesmo com NLA ativado, RDP exposto e alvo constante de ataques de forca bruta e credential stuffing."
                rationale = "RDP com NLA reduz a superficie de ataque mas nao elimina o risco. Recomenda-se acesso apenas via VPN."
                remediation = "Restrinja acesso RDP via firewall para IPs especificos ou exija VPN antes de conectar. Ative bloqueio de conta apos tentativas falhas."
                references = @("CISA Advisory AA21-131A","CIS Windows Server Benchmark")
                affectedResource = "$TargetIp[[BT]]:3389"
                evidence = @{ port = 3389; nlaDetected = $true }
            }
        }
    } else { $passedChecks++ }

    # ─── Check: SMB exposto ───────────────────────────────────────────────────
    $totalChecks++
    if ($openPorts -contains 445) {
        $findings += @{
            controlId = "NET.1.4"; title = "SMB exposto (porta 445)"; category = "Exposicao de Servicos"
            severity = "high"
            description = "Porta SMB 445 esta aberta em $TargetIp. SMB e o vetor de propagacao de ransomware mais utilizado (WannaCry, NotPetya, EternalBlue)."
            rationale = "CISA recomenda bloquear porta 445 em todos os dispositivos voltados para redes nao confiáveis. SMBv1 possui vulnerabilidades criticas exploradas por ferramentas NSA vazadas."
            remediation = "1. Bloqueie porta 445 no firewall para redes externas e DMZ. 2. Desabilite SMBv1: Set-SmbServerConfiguration -EnableSMB1Protocol [[BT]]$false. 3. Aplique MS17-010 (EternalBlue patch)."
            references = @("CVE-2017-0143 (EternalBlue)","MS17-010","CISA Alert AA20-049A")
            affectedResource = "$TargetIp[[BT]]:445"
            evidence = @{ port = 445; open = $true }
        }
    } else { $passedChecks++ }

    # ─── Check: FTP anonimo/cleartext ─────────────────────────────────────────
    $totalChecks++
    if ($openPorts -contains 21) {
        $banner = Get-Banner -Target $TargetIp -Port 21 -TimeoutMs 3000
        $anonCheck = $false
        try {
            $req = [System.Net.FtpWebRequest]::Create("ftp://$TargetIp/")
            $req.Method      = [System.Net.WebRequestMethods+Ftp]::ListDirectory
            $req.Credentials = New-Object System.Net.NetworkCredential("anonymous","probe@wnr.test")
            $req.Timeout     = 5000
            $resp = $req.GetResponse()
            $resp.Close()
            $anonCheck = $true
        } catch {}
        if ($anonCheck) {
            $findings += @{
                controlId = "NET.1.5"; title = "FTP com acesso anonimo habilitado"; category = "Controle de Acesso"
                severity = "critical"
                description = "FTP em $TargetIp[[BT]]:21 aceita login anonimo. Qualquer pessoa pode listar e potencialmente fazer download de arquivos sem autenticacao."
                rationale = "FTP anonimo e um vetor classico de exfiltracao de dados e upload de webshells/malware."
                remediation = "Desabilite FTP anonimo imediatamente. Considere substituir FTP por SFTP (SSH) ou FTPS. Banner detectado: $banner"
                references = @("CIS Benchmark","OWASP Testing Guide — OTG-CONFIG-007")
                affectedResource = "$TargetIp[[BT]]:21"
                evidence = @{ port = 21; anonymousLogin = $true; banner = $banner }
            }
        } else {
            $findings += @{
                controlId = "NET.1.5b"; title = "FTP (cleartext) em operacao"; category = "Protocolos Inseguros"
                severity = "medium"
                description = "FTP em $TargetIp[[BT]]:21 transmite credenciais e dados em texto claro. Substitua por SFTP ou FTPS."
                rationale = "FTP nao possui criptografia nativa. Sniffing de credenciais e trivial em redes locais."
                remediation = "Substitua FTP por SFTP (porta 22) ou configure FTPS (FTP over TLS). Desabilite FTP se nao for necessario."
                references = @("RFC 4217","CIS Benchmark")
                affectedResource = "$TargetIp[[BT]]:21"
                evidence = @{ port = 21; banner = $banner }
            }
        }
    } else { $passedChecks++ }

    # ─── Check: SNMP default community strings ────────────────────────────────
    $totalChecks++
    if ($openPorts -contains 161) {
        $findings += @{
            controlId = "NET.1.6"; title = "SNMP exposto (porta 161/UDP)"; category = "Exposicao de Servicos"
            severity = "high"
            description = "SNMP esta respondendo em $TargetIp[[BT]]:161. Se community strings padrao (public/private) estiverem ativas, atacantes podem ler/alterar configuracoes do dispositivo."
            rationale = "SNMPv1/v2c nao possui autenticacao criptografica. Community strings em texto claro sao interceptaveis. SNMPv3 e o unico padrao seguro."
            remediation = "1. Mude community strings de 'public'/'private' para strings complexas. 2. Migre para SNMPv3 com autenticacao SHA e privacidade AES. 3. Restrinja acesso SNMP por IP via ACL."
            references = @("CIS Benchmark — SNMP","NIST SP 800-115")
            affectedResource = "$TargetIp[[BT]]:161"
            evidence = @{ port = 161; open = $true }
        }
    } else { $passedChecks++ }

    # ─── Check: HTTP sem HTTPS (portas 80/8080/8888) ─────────────────────────
    $totalChecks++
    $httpPorts = @(80, 8080, 8888) | Where-Object { $openPorts -contains $_ }
    if ($httpPorts.Count -gt 0) {
        foreach ($hp in $httpPorts) {
            $headers = Get-HttpHeaders -Url "http://$TargetIp[[BT]]:$hp" -TimeoutMs 5000
            $hsts = $headers.ContainsKey("Strict-Transport-Security")
            if (-not $hsts) {
                $findings += @{
                    controlId = "NET.2.1"; title = "HTTP sem HSTS em porta $hp"; category = "Criptografia em Transito"
                    severity = "medium"
                    description = "Servico HTTP em $TargetIp[[BT]]:$hp nao redireciona para HTTPS e/ou nao possui header HSTS. Dados trafegam em texto claro."
                    rationale = "Sem HTTPS, credenciais, tokens de sessao e dados confidenciais ficam expostos a ataques MITM e sniffing na rede local."
                    remediation = "Configure redirecionamento 301 para HTTPS. Adicione header: Strict-Transport-Security: max-age=31536000; includeSubDomains. Use certificado TLS valido."
                    references = @("OWASP Transport Layer Security Cheat Sheet","RFC 6797 (HSTS)")
                    affectedResource = "http://$TargetIp[[BT]]:$hp"
                    evidence = @{ port = $hp; hsts = $false }
                }
            } else { $passedChecks++ }
        }
    } else { $passedChecks++ }

    # ─── Check: HTTPS security headers ───────────────────────────────────────
    $totalChecks++
    $httpsPorts = @(443, 8443) | Where-Object { $openPorts -contains $_ }
    if ($httpsPorts.Count -gt 0) {
        foreach ($sp in $httpsPorts) {
            $headers = Get-HttpHeaders -Url "https://$TargetIp[[BT]]:$sp" -TimeoutMs 5000
            $missing = @()
            if (-not $headers.ContainsKey("X-Frame-Options")) { $missing += "X-Frame-Options" }
            if (-not $headers.ContainsKey("X-Content-Type-Options")) { $missing += "X-Content-Type-Options" }
            if (-not $headers.ContainsKey("Content-Security-Policy")) { $missing += "Content-Security-Policy" }
            if (-not $headers.ContainsKey("Strict-Transport-Security")) { $missing += "HSTS" }
            if ($missing.Count -gt 0) {
                $findings += @{
                    controlId = "NET.2.2"; title = "Headers de seguranca HTTP ausentes"; category = "Seguranca de Aplicacao"
                    severity = "medium"
                    description = "O servico HTTPS em $TargetIp[[BT]]:$sp nao envia headers de seguranca: $($missing -join ', '). Isso aumenta o risco de XSS, clickjacking e MITM."
                    rationale = "Headers de seguranca sao controles de defesa em profundidade recomendados pelo OWASP e exigidos por ISO 27001 A.14.1."
                    remediation = "Adicione ao servidor web: X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Content-Security-Policy, Strict-Transport-Security."
                    references = @("OWASP Secure Headers Project","CIS Apache/Nginx Benchmark")
                    affectedResource = "https://$TargetIp[[BT]]:$sp"
                    evidence = @{ port = $sp; missingHeaders = $missing }
                }
            } else { $passedChecks++ }
        }
    } else { $passedChecks++ }

    # ─── Check: Banco de dados exposto ────────────────────────────────────────
    $totalChecks++
    $dbPorts = @(
        @{ Port = 3306; Name = "MySQL" },
        @{ Port = 5432; Name = "PostgreSQL" },
        @{ Port = 1433; Name = "Microsoft SQL Server" },
        @{ Port = 27017; Name = "MongoDB" },
        @{ Port = 6379; Name = "Redis" },
        @{ Port = 9200; Name = "Elasticsearch" },
        @{ Port = 1521; Name = "Oracle DB" }
    )
    $exposedDbs = $dbPorts | Where-Object { $openPorts -contains $_.Port }
    if ($exposedDbs.Count -gt 0) {
        foreach ($db in $exposedDbs) {
            $findings += @{
                controlId = "NET.1.7"; title = "$($db.Name) exposto na rede (porta $($db.Port))"; category = "Exposicao de Dados"
                severity = "critical"
                description = "Banco de dados $($db.Name) acessivel diretamente na rede em $TargetIp[[BT]]:$($db.Port). Bancos de dados nao devem ser acessiveis sem autenticacao de rede."
                rationale = "Bancos de dados expostos sao alvos primarios de exfiltracao. Credenciais padrao, versoes desatualizadas e falta de autenticacao levam a comprometimento total dos dados."
                remediation = "1. Bloqueie acesso direto ao banco via firewall (permita apenas aplicacao e DBA com IP fixo). 2. Verifique autenticacao obrigatoria. 3. Desabilite usuarios anonimos/default. 4. Aplique patches de seguranca."
                references = @("OWASP Top 10 — A05:2021 Security Misconfiguration","CIS Database Benchmark")
                affectedResource = "$TargetIp[[BT]]:$($db.Port)"
                evidence = @{ port = $db.Port; service = $db.Name }
            }
        }
    } else { $passedChecks++ }

    # ─── Check: VNC exposto ───────────────────────────────────────────────────
    $totalChecks++
    if ($openPorts -contains 5900) {
        $findings += @{
            controlId = "NET.1.8"; title = "VNC exposto (porta 5900)"; category = "Exposicao de Acesso Remoto"
            severity = "high"
            description = "VNC esta ativo em $TargetIp[[BT]]:5900. VNC frequentemente opera sem criptografia e com senhas fracas ou ausentes."
            rationale = "VNC sem TLS transmite sessao grafica completa em texto claro. Ferramentas como Hydra automatizam ataques de forca bruta em segundos."
            remediation = "Desabilite VNC se nao for necessario. Se necessario: use VNC over SSH tunnel, configure senha forte (min 12 chars), restrinja IPs via firewall."
            references = @("CVE-2019-15681","NIST SP 800-115")
            affectedResource = "$TargetIp[[BT]]:5900"
            evidence = @{ port = 5900; open = $true }
        }
    } else { $passedChecks++ }

    # ─── Check: R-services (rsh/rexec/rlogin) ────────────────────────────────
    $totalChecks++
    $rPorts = @(512, 513, 514) | Where-Object { $openPorts -contains $_ }
    if ($rPorts.Count -gt 0) {
        $findings += @{
            controlId = "NET.1.9"; title = "R-services BSD expostos (rsh/rexec/rlogin)"; category = "Protocolos Inseguros"
            severity = "critical"
            description = "Servicos legados R-services detectados em $TargetIp (portas: $($rPorts -join ', ')). Esses servicos nao possuem autenticacao nem criptografia."
            rationale = "R-services foram substituidos pelo SSH em 1995. Permitem execucao remota de comandos sem senha em hosts de confianca (.rhosts). CISA recomenda remocao imediata."
            remediation = "Desabilite e remova xinetd/inetd entries para rsh, rexec, rlogin. No Linux: chkconfig rsh off; chkconfig rlogin off; chkconfig rexec off."
            references = @("CISA Advisory","CIS Benchmark — 2.2.17","CVE-2004-0230")
            affectedResource = "$TargetIp (portas $($rPorts -join ', '))"
            evidence = @{ ports = $rPorts }
        }
    } else { $passedChecks++ }

    # ─── Check: LDAP anonimo ─────────────────────────────────────────────────
    $totalChecks++
    if ($openPorts -contains 389) {
        $findings += @{
            controlId = "NET.1.10"; title = "LDAP exposto (porta 389 nao criptografado)"; category = "Exposicao de Servicos"
            severity = "medium"
            description = "LDAP em $TargetIp[[BT]]:389 esta acessivel. LDAP sem TLS (LDAPS/StartTLS) transmite credenciais em texto claro e pode permitir enumeracao de usuarios do AD."
            rationale = "Consultas LDAP anonimas podem revelar toda a estrutura do Active Directory, incluindo usuarios, grupos e politicas. Dado critico para ataques de reconhecimento."
            remediation = "1. Configure LDAPS (porta 636) com certificado TLS. 2. Desabilite bind anonimo: Set-ADObject -Identity 'CN=Directory Service,...' -Add @{anonymousLDAPOperationsAllowed=0}. 3. Bloqueie porta 389 externamente."
            references = @("CIS AD Benchmark","MS KB2540068","NIST SP 800-115")
            affectedResource = "$TargetIp[[BT]]:389"
            evidence = @{ port = 389; open = $true }
        }
    } else { $passedChecks++ }

    # ─── Check: WinRM exposto ─────────────────────────────────────────────────
    $totalChecks++
    $winrmPorts = @(5985, 5986) | Where-Object { $openPorts -contains $_ }
    if ($winrmPorts.Count -gt 0) {
        $findings += @{
            controlId = "NET.1.11"; title = "WinRM exposto (PowerShell Remoting)"; category = "Exposicao de Acesso Remoto"
            severity = "high"
            description = "WinRM (Windows Remote Management) ativo em $TargetIp (portas: $($winrmPorts -join ', ')). Permite execucao remota de PowerShell — alvo de movimentacao lateral."
            rationale = "WinRM e frequentemente explorado em ataques APT para movimentacao lateral apos comprometimento inicial. Deve ser restrito por IP e protocolos fortes."
            remediation = "1. Restrinja WinRM a IPs administrativos via firewall. 2. Exija HTTPS (porta 5986). 3. Use Set-Item WSMan:\\localhost\\Service\\Auth\\Basic \$false para desabilitar auth basica."
            references = @("MITRE ATT&CK T1021.006","CIS Windows Server Benchmark")
            affectedResource = "$TargetIp (portas $($winrmPorts -join ', '))"
            evidence = @{ ports = $winrmPorts }
        }
    } else { $passedChecks++ }

    # ─── Check: NFS exposto ────────────────────────────────────────────────────
    $totalChecks++
    if ($openPorts -contains 2049) {
        $findings += @{
            controlId = "NET.1.12"; title = "NFS exposto (porta 2049)"; category = "Exposicao de Dados"
            severity = "high"
            description = "NFS (Network File System) detectado em $TargetIp[[BT]]:2049. Compartilhamentos NFS mal configurados podem ser montados por qualquer host na rede."
            rationale = "NFS v2/v3 nao possui autenticacao robusta. Exports com '*' (wildcard) permitem qualquer host montar e modificar o sistema de arquivos remotamente."
            remediation = "1. Revise /etc/exports — remova wildcards. 2. Use NFS v4 com Kerberos (sec=krb5p). 3. Restrinja hosts autorizados por IP. 4. Bloqueie porta 2049 no firewall perimetral."
            references = @("CIS Linux Benchmark","NIST SP 800-115")
            affectedResource = "$TargetIp[[BT]]:2049"
            evidence = @{ port = 2049; open = $true }
        }
    } else { $passedChecks++ }

    # ─── Check: Portas em excesso ─────────────────────────────────────────────
    $totalChecks++
    if ($openPorts.Count -gt 10) {
        $findings += @{
            controlId = "NET.2.3"; title = "Numero elevado de portas abertas ($($openPorts.Count))"; category = "Reducao de Superficie de Ataque"
            severity = "medium"
            description = "$TargetIp possui $($openPorts.Count) portas TCP abertas: $($openPorts -join ', '). Cada porta aberta e uma superficie de ataque adicional."
            rationale = "Principio de minimo privilegio de rede: apenas servicos estritamente necessarios devem estar acessiveis. ISO 27001 A.13.1.1 exige controles de rede baseados em necessidade."
            remediation = "Revise cada servico em operacao. Desative servicos nao utilizados. Configure firewall local (Windows Firewall/iptables/nftables) para bloquear portas nao necessarias."
            references = @("ISO 27001 A.13.1.1","CIS Benchmark — Minimize Services","NIST SP 800-115 Section 3.2")
            affectedResource = "$TargetIp ($($openPorts.Count) portas abertas)"
            evidence = @{ openPorts = $openPorts; count = $openPorts.Count }
        }
    } else { $passedChecks++ }

    return @{
        findings     = $findings
        totalChecks  = $totalChecks
        passedChecks = $passedChecks
        openPorts    = $openPorts
    }
}

# ─── Main loop ───────────────────────────────────────────────────────────────
Write-Log "WNR Audit Security Probe v$VERSION iniciado (PID: $PID)"
$startTime = Get-Date

while ($true) {
    Write-Heartbeat

    # Auto-recycle after RECYCLE_HOURS
    if ((Get-Date) -gt $startTime.AddHours($RECYCLE_HOURS)) {
        Write-Log "Reciclagem programada — reiniciando agente"
        exit 0
    }

    try {
        $checkinBody = @{
            hostname       = $env:COMPUTERNAME
            ipAddress      = Get-LocalIP
            os             = (Get-WmiObject Win32_OperatingSystem -ErrorAction SilentlyContinue).Caption
            agentVersion   = $VERSION
            probeMachineId = Get-MachineId
        }

        $resp = Invoke-Api -Method "POST" -Path "/probe/checkin" -Body $checkinBody

        if ($resp -and $resp.pendingJobs -and $resp.pendingJobs.Count -gt 0) {
            foreach ($job in $resp.pendingJobs) {
                Write-Log "Executando scan job $($job.jobId) -> $($job.targetIp) [$($job.deviceType)]"
                $result = Invoke-ProbeNetworkScan -TargetIp $job.targetIp -DeviceType $job.deviceType
                Write-Log "Scan concluido: $($result.findings.Count) achados, portas abertas: $($result.openPorts -join ',')"

                $resultBody = @{
                    status       = "completed"
                    findings     = $result.findings
                    totalChecks  = $result.totalChecks
                    passedChecks = $result.passedChecks
                }
                Invoke-Api -Method "POST" -Path "/probe/results/$($job.jobId)" -Body $resultBody
            }
        }
    } catch {
        Write-Log "Erro no loop principal: $_" "ERROR"
    }

    Start-Sleep -Seconds $CHECKIN_INTERVAL
}
'@ -replace "API_URL_PLACEHOLDER", $ApiUrl [[BT]]
   -replace "INSTALL_DIR_PLACEHOLDER", $InstallDir [[BT]]
   -replace "LOG_FILE_PLACEHOLDER", $LogFile
}

function Get-WatchdogScript {
    param([string]$InstallDir, [string]$AgentScript, [string]$TaskName, [string]$LogFile)
    return @"
# WNR Audit Probe Watchdog
[[BT]]$HEARTBEAT = "$InstallDir\\health\\heartbeat.json"
[[BT]]$LOG_FILE  = "$LogFile"
[[BT]]$TASK_NAME = "$TaskName"
[[BT]]$MAX_AGE   = 4 # minutes without heartbeat before restart

function Write-Log {
    param([string][[BT]]$Msg)
    [[BT]]$ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path [[BT]]$LOG_FILE -Value "[ [[BT]]$ts][WATCHDOG] [[BT]]$Msg" -Encoding UTF8 -ErrorAction SilentlyContinue
}

if (-not (Test-Path [[BT]]$HEARTBEAT)) {
    Write-Log "Heartbeat ausente — iniciando agente"
    Start-ScheduledTask -TaskName [[BT]]$TASK_NAME -ErrorAction SilentlyContinue
    exit 0
}

[[BT]]$hb   = Get-Content [[BT]]$HEARTBEAT -Raw | ConvertFrom-Json -ErrorAction SilentlyContinue
[[BT]]$age  = (Get-Date) - [datetime][[BT]]$hb.ts
if ([[BT]]$age.TotalMinutes -gt [[BT]]$MAX_AGE) {
    Write-Log "Heartbeat com [[BT]]$([int][[BT]]$age.TotalMinutes)min de atraso — reiniciando"
    Stop-Process -Id [[BT]]$hb.pid -Force -ErrorAction SilentlyContinue
    Start-ScheduledTask -TaskName [[BT]]$TASK_NAME -ErrorAction SilentlyContinue
}
"@
}
`).replace(/\[\[BT\]\]/g, "`");
}

export default router;
