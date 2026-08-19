#Requires -Version 2.0
# WNR Audit Security Probe v1.0
# Cliente: %%DISPLAY_NAME%%
# Gerado em: %%GENERATED_AT%%
# Isolamento: instalacao em C:\Program Files\WNRAudit-Probe\ — nao conflita com WinnerRMM-Legacy
<#
.SYNOPSIS
    WNR Audit Security Probe — Instalador
    Winner Tecnologia / WTI Corp

.DESCRIPTION
    Instala o agente de segurança WNR Audit como tarefa agendada (SYSTEM).
    Requer execução como Administrador.

#>

param(
    [switch]$Uninstall
)

$PROBE_TOKEN   = "%%PROBE_TOKEN%%"
$API_URL       = "https://wnrtecnologia.com.br/wnraudit/api"
$INSTALL_DIR   = "C:\Program Files\WNRAudit-Probe"
$AGENT_SCRIPT  = Join-Path $INSTALL_DIR "probe_agent.ps1"
$LOG_FILE      = Join-Path $INSTALL_DIR "probe_agent.log"
$TASK_AGENT    = "WNRAuditProbeAgent"
$TASK_WATCHDOG = "WNRAuditProbeWatchdog"
$WATCHDOG_SCRIPT = Join-Path $INSTALL_DIR "probe_watchdog.ps1"

# ─── Privilege check ─────────────────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[ERRO] Execute este script como Administrador." -ForegroundColor Red
    exit 1
}

function Write-Log {
    param([string]$Msg, [string]$Level = "INFO")
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts][$Level] $Msg"
    Add-Content -Path $LOG_FILE -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
    Write-Host $line
}


# ─── Uninstall ───────────────────────────────────────────────────────────────
if ($Uninstall) {
    Write-Host "Removendo WNR Audit Security Probe..."
    schtasks /Delete /TN $TASK_AGENT    /F 2>$null | Out-Null
    schtasks /Delete /TN $TASK_WATCHDOG /F 2>$null | Out-Null
    if (Test-Path $INSTALL_DIR) { Remove-Item $INSTALL_DIR -Recurse -Force }
    Write-Host "Probe removido com sucesso."
    exit 0
}

if ($PROBE_TOKEN.Length -lt 32) {
    Write-Host "[ERRO] Token invalido (muito curto). Verifique o token no painel WNR Audit." -ForegroundColor Red
    exit 1
}

# ─── Install ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== WNR Audit Security Probe ===" -ForegroundColor Cyan
Write-Host "Cliente : %%DISPLAY_NAME%%"
Write-Host "API     : $API_URL"
Write-Host "Destino : $INSTALL_DIR"
Write-Host ""

if (-not (Test-Path $INSTALL_DIR)) { New-Item -ItemType Directory -Path $INSTALL_DIR -Force | Out-Null }

# Protect directory: SYSTEM + Admins full, Users read-only
$acl = Get-Acl $INSTALL_DIR
$acl.SetAccessRuleProtection($true, $false)
$rule1 = New-Object System.Security.AccessControl.FileSystemAccessRule("SYSTEM","FullControl","Allow")
$rule2 = New-Object System.Security.AccessControl.FileSystemAccessRule("Administrators","FullControl","Allow")
$rule3 = New-Object System.Security.AccessControl.FileSystemAccessRule("Users","ReadAndExecute","Allow")
$acl.SetAccessRule($rule1); $acl.SetAccessRule($rule2); $acl.SetAccessRule($rule3)
Set-Acl -Path $INSTALL_DIR -AclObject $acl -ErrorAction SilentlyContinue

# Store token encrypted with DPAPI (LocalMachine scope — only decryptable on this machine)
Add-Type -AssemblyName System.Security
$tokenBytes = [System.Text.Encoding]::UTF8.GetBytes($PROBE_TOKEN)
$encrypted  = [System.Security.Cryptography.ProtectedData]::Protect(
    $tokenBytes, $null,
    [System.Security.Cryptography.DataProtectionScope]::LocalMachine
)
$secureDir = Join-Path $INSTALL_DIR "secure"
if (-not (Test-Path $secureDir)) { New-Item -ItemType Directory -Path $secureDir -Force | Out-Null }
[System.IO.File]::WriteAllBytes((Join-Path $secureDir "probe_token.dat"), $encrypted)

# ─── Agent script ─────────────────────────────────────────────────────────────
$agentCode = @"
#Requires -Version 2.0
# WNR Audit Security Probe — Agent
Add-Type -AssemblyName System.Security

`$API_URL     = "$API_URL"
`$INSTALL_DIR = "$INSTALL_DIR"
`$LOG_FILE    = "$LOG_FILE"
`$HEARTBEAT   = Join-Path `$INSTALL_DIR "health\heartbeat.json"
`$SECURE_DIR  = Join-Path `$INSTALL_DIR "secure"
`$VERSION     = "1.0"
`$CHECKIN_INTERVAL = 60
`$RECYCLE_HOURS    = 8

function Write-Log {
    param([string]`$Msg, [string]`$Level = "INFO")
    `$ts   = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    `$line = "[`$ts][`$Level] `$Msg"
    Add-Content -Path `$LOG_FILE -Value `$line -Encoding UTF8 -ErrorAction SilentlyContinue
}

function Write-Heartbeat {
    `$dir = Split-Path `$HEARTBEAT
    if (-not (Test-Path `$dir)) { New-Item -ItemType Directory -Path `$dir -Force | Out-Null }
    @{ ts = (Get-Date -Format "o"); pid = `$PID } | ConvertTo-Json | Set-Content -Path `$HEARTBEAT -Encoding UTF8
}

function Get-ProbeToken {
    `$dat = Join-Path `$SECURE_DIR "probe_token.dat"
    `$encrypted = [System.IO.File]::ReadAllBytes(`$dat)
    `$bytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
        `$encrypted, `$null,
        [System.Security.Cryptography.DataProtectionScope]::LocalMachine
    )
    return [System.Text.Encoding]::UTF8.GetString(`$bytes)
}

function Get-LocalIP {
    try {
        `$adapters = Get-WmiObject Win32_NetworkAdapterConfiguration -Filter "IPEnabled=True" -ErrorAction Stop
        foreach (`$a in `$adapters) {
            foreach (`$ip in `$a.IPAddress) {
                if (`$ip -match "^\d+\.\d+\.\d+\.\d+$" -and `$ip -notmatch "^127\.") { return `$ip }
            }
        }
    } catch {}
    return "unknown"
}

function Get-MachineId {
    `$idFile = Join-Path `$INSTALL_DIR "probe_machine_id"
    if (Test-Path `$idFile) { return (Get-Content `$idFile -Raw).Trim() }
    `$id = [System.Guid]::NewGuid().ToString()
    Set-Content -Path `$idFile -Value `$id -Encoding UTF8
    return `$id
}

function Invoke-Api {
    param([string]`$Method, [string]`$Path, [hashtable]`$Body = @{})
    try {
        `$token   = Get-ProbeToken
        `$url     = "`$API_URL`$Path"
        `$json    = `$Body | ConvertTo-Json -Depth 10
        `$bytes   = [System.Text.Encoding]::UTF8.GetBytes(`$json)
        `$req     = [System.Net.HttpWebRequest]::Create(`$url)
        `$req.Method        = `$Method
        `$req.ContentType   = "application/json"
        `$req.ContentLength = `$bytes.Length
        `$req.Timeout       = 30000
        `$req.UserAgent     = "WNRAudit-Probe/`$VERSION"
        `$req.Headers.Add("Authorization", "Bearer `$token")
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
        `$stream = `$req.GetRequestStream()
        `$stream.Write(`$bytes, 0, `$bytes.Length)
        `$stream.Close()
        `$resp   = `$req.GetResponse()
        `$reader = New-Object System.IO.StreamReader(`$resp.GetResponseStream())
        `$result = `$reader.ReadToEnd()
        `$reader.Close(); `$resp.Close()
        return `$result | ConvertFrom-Json
    } catch {
        Write-Log "Invoke-Api `$Method `$Path failed: `$_" "WARN"
        return `$null
    }
}

function Test-TcpPort {
    param([string]`$Target, [int]`$Port, [int]`$TimeoutMs = 2000)
    try {
        `$tcp = New-Object System.Net.Sockets.TcpClient
        `$ar  = `$tcp.BeginConnect(`$Target, `$Port, `$null, `$null)
        `$ok  = `$ar.AsyncWaitHandle.WaitOne(`$TimeoutMs, `$false)
        if (`$ok -and `$tcp.Connected) { `$tcp.EndConnect(`$ar); `$tcp.Close(); return `$true }
        `$tcp.Close()
    } catch {}
    return `$false
}

function Get-Banner {
    param([string]`$Target, [int]`$Port, [int]`$TimeoutMs = 3000)
    try {
        `$tcp    = New-Object System.Net.Sockets.TcpClient
        `$ar     = `$tcp.BeginConnect(`$Target, `$Port, `$null, `$null)
        if (-not `$ar.AsyncWaitHandle.WaitOne(`$TimeoutMs, `$false)) { `$tcp.Close(); return `$null }
        `$stream = `$tcp.GetStream()
        `$stream.ReadTimeout = `$TimeoutMs
        `$buf  = New-Object byte[] 512
        `$read = `$stream.Read(`$buf, 0, 512)
        `$tcp.Close()
        return [System.Text.Encoding]::ASCII.GetString(`$buf, 0, `$read).Trim()
    } catch { return `$null }
}

function Get-HttpHeaders {
    param([string]`$Url, [int]`$TimeoutMs = 5000)
    try {
        `$req = [System.Net.HttpWebRequest]::Create(`$Url)
        `$req.Timeout = `$TimeoutMs
        `$req.AllowAutoRedirect = `$false
        `$req.UserAgent = "WNRAudit-Probe/`$VERSION"
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
        `$resp = `$req.GetResponse()
        `$h = @{}
        foreach (`$k in `$resp.Headers.AllKeys) { `$h[`$k] = `$resp.Headers[`$k] }
        `$h["__StatusCode"] = [int]`$resp.StatusCode
        `$resp.Close()
        return `$h
    } catch [System.Net.WebException] {
        if (`$_.Exception.Response) {
            `$h = @{}
            foreach (`$k in `$_.Exception.Response.Headers.AllKeys) { `$h[`$k] = `$_.Exception.Response.Headers[`$k] }
            `$h["__StatusCode"] = [int]`$_.Exception.Response.StatusCode
            `$_.Exception.Response.Close()
            return `$h
        }
        return @{}
    } catch { return @{} }
}

function Invoke-ProbeNetworkScan {
    param([string]`$TargetIp, [string]`$DeviceType)
    `$findings = @(); `$totalChecks = 0; `$passedChecks = 0

    `$PORTS_TO_SCAN = @(21,22,23,25,53,80,110,111,135,139,143,161,389,443,445,512,513,514,1433,1521,2049,3306,3389,4444,5432,5900,5985,5986,6379,8080,8443,8888,9200,27017)
    `$openPorts = @()
    foreach (`$port in `$PORTS_TO_SCAN) {
        if (Test-TcpPort -Target `$TargetIp -Port `$port -TimeoutMs 1500) { `$openPorts += `$port }
    }

    `$totalChecks++
    if (`$openPorts -contains 23) {
        `$findings += @{ controlId="NET.1.1"; title="Telnet exposto (porta 23)"; category="Protocolos Inseguros"; severity="critical"; description="Telnet ativo em `${TargetIp}:23. Credenciais em texto claro."; rationale="Telnet depreciado desde 1995. Interceptacao trivial via Wireshark."; remediation="Desabilite Telnet. Use SSH. No Windows: Services.msc. No Linux: systemctl disable telnetd."; references=@("NIST SP 800-115","CIS Benchmark"); affectedResource="`${TargetIp}:23"; evidence=@{port=23;open=`$true} }
    } else { `$passedChecks++ }

    `$totalChecks++
    if (`$openPorts -contains 22) {
        `$banner = Get-Banner -Target `$TargetIp -Port 22 -TimeoutMs 3000
        if (`$banner -and `$banner -match "SSH-1\.") {
            `$findings += @{ controlId="NET.1.2"; title="SSHv1 detectado"; category="Protocolos Inseguros"; severity="critical"; description="SSH em `${TargetIp}:22 suporta SSHv1 com vulnerabilidades criticas."; rationale="SSHv1 tem falhas no protocolo de autenticacao. Depreciado em 2006 (RFC 4253)."; remediation="Edite /etc/ssh/sshd_config: Protocol 2. Reinicie SSH."; references=@("CVE-2001-0361","RFC 4253"); affectedResource="`${TargetIp}:22"; evidence=@{port=22;banner=`$banner} }
        } else { `$passedChecks++ }
    } else { `$passedChecks++ }

    `$totalChecks++
    if (`$openPorts -contains 3389) {
        `$nlaMissing = `$false
        try {
            `$tcp = New-Object System.Net.Sockets.TcpClient(`$TargetIp, 3389)
            `$stream = `$tcp.GetStream()
            `$rdpNego = [byte[]](0x03,0x00,0x00,0x13,0x0E,0xE0,0x00,0x00,0x00,0x00,0x00,0x01,0x00,0x08,0x00,0x03,0x00,0x00,0x00)
            `$stream.Write(`$rdpNego, 0, `$rdpNego.Length)
            `$stream.ReadTimeout = 3000
            `$buf = New-Object byte[] 64
            `$read = `$stream.Read(`$buf, 0, 64)
            if (`$read -gt 15 -and `$buf[15] -ne 0x03) { `$nlaMissing = `$true }
            `$tcp.Close()
        } catch { `$nlaMissing = `$false }
        if (`$nlaMissing) {
            `$findings += @{ controlId="NET.1.3"; title="RDP sem NLA"; category="Exposicao de Acesso Remoto"; severity="high"; description="RDP em `${TargetIp}:3389 sem autenticacao NLA."; rationale="Sem NLA, BlueKeep (CVE-2019-0708) opera pre-autenticacao."; remediation="Ative NLA: Painel de Controle > Sistema > Configuracoes remotas."; references=@("CVE-2019-0708","CIS Windows Server Benchmark"); affectedResource="`${TargetIp}:3389"; evidence=@{port=3389;nlaDetected=`$false} }
        } else {
            `$findings += @{ controlId="NET.1.3b"; title="RDP exposto na rede"; category="Exposicao de Acesso Remoto"; severity="medium"; description="RDP em `${TargetIp}:3389 acessivel. Alvo de brute force."; rationale="RDP exposto sem VPN aumenta superficie de ataque."; remediation="Restrinja via firewall ou exija VPN."; references=@("CISA Advisory AA21-131A"); affectedResource="`${TargetIp}:3389"; evidence=@{port=3389;nlaDetected=`$true} }
        }
    } else { `$passedChecks++ }

    `$totalChecks++
    if (`$openPorts -contains 445) {
        `$findings += @{ controlId="NET.1.4"; title="SMB exposto (porta 445)"; category="Exposicao de Servicos"; severity="high"; description="SMB 445 aberta em `$TargetIp. Vetor de propagacao de ransomware."; rationale="WannaCry, NotPetya, EternalBlue exploraram SMB. CISA recomenda bloquear."; remediation="Bloqueie 445 no firewall. Desabilite SMBv1: Set-SmbServerConfiguration -EnableSMB1Protocol `$false."; references=@("CVE-2017-0143","MS17-010","CISA Alert AA20-049A"); affectedResource="`${TargetIp}:445"; evidence=@{port=445;open=`$true} }
    } else { `$passedChecks++ }

    `$totalChecks++
    if (`$openPorts -contains 21) {
        `$banner = Get-Banner -Target `$TargetIp -Port 21 -TimeoutMs 3000
        `$anonCheck = `$false
        try {
            `$req = [System.Net.FtpWebRequest]::Create("ftp://`$TargetIp/")
            `$req.Method = [System.Net.WebRequestMethods+Ftp]::ListDirectory
            `$req.Credentials = New-Object System.Net.NetworkCredential("anonymous","probe@wnr.test")
            `$req.Timeout = 5000
            `$resp = `$req.GetResponse(); `$resp.Close(); `$anonCheck = `$true
        } catch {}
        if (`$anonCheck) {
            `$findings += @{ controlId="NET.1.5"; title="FTP anonimo habilitado"; category="Controle de Acesso"; severity="critical"; description="FTP em `${TargetIp}:21 aceita login anonimo."; rationale="FTP anonimo e vetor classico de exfiltracao e upload de malware."; remediation="Desabilite FTP anonimo. Use SFTP ou FTPS."; references=@("CIS Benchmark","OWASP OTG-CONFIG-007"); affectedResource="`${TargetIp}:21"; evidence=@{port=21;anonymousLogin=`$true;banner=`$banner} }
        } else {
            `$findings += @{ controlId="NET.1.5b"; title="FTP cleartext em operacao"; category="Protocolos Inseguros"; severity="medium"; description="FTP em `${TargetIp}:21 sem criptografia."; rationale="FTP transmite credenciais em texto claro. Sniffing trivial."; remediation="Substitua por SFTP ou FTPS."; references=@("RFC 4217","CIS Benchmark"); affectedResource="`${TargetIp}:21"; evidence=@{port=21;banner=`$banner} }
        }
    } else { `$passedChecks++ }

    `$totalChecks++
    if (`$openPorts -contains 161) {
        `$findings += @{ controlId="NET.1.6"; title="SNMP exposto (161/UDP)"; category="Exposicao de Servicos"; severity="high"; description="SNMP respondendo em `${TargetIp}:161. Community strings padrao possivelmente ativas."; rationale="SNMPv1/v2c sem autenticacao criptografica. Community strings interceptaveis."; remediation="Mude community strings. Migre para SNMPv3 com SHA+AES. Restrinja por ACL."; references=@("CIS Benchmark — SNMP","NIST SP 800-115"); affectedResource="`${TargetIp}:161"; evidence=@{port=161;open=`$true} }
    } else { `$passedChecks++ }

    `$totalChecks++
    `$httpPorts = @(80,8080,8888) | Where-Object { `$openPorts -contains `$_ }
    if (`$httpPorts.Count -gt 0) {
        foreach (`$hp in `$httpPorts) {
            `$headers = Get-HttpHeaders -Url "http://`${TargetIp}:`$hp" -TimeoutMs 5000
            if (-not `$headers.ContainsKey("Strict-Transport-Security")) {
                `$findings += @{ controlId="NET.2.1"; title="HTTP sem HSTS em porta `$hp"; category="Criptografia em Transito"; severity="medium"; description="HTTP em `${TargetIp}:`$hp sem redirecionamento HTTPS ou HSTS."; rationale="Sem HTTPS, credenciais ficam expostas a MITM."; remediation="Configure redirect 301 para HTTPS e header Strict-Transport-Security."; references=@("OWASP TLS Cheat Sheet","RFC 6797"); affectedResource="http://`${TargetIp}:`$hp"; evidence=@{port=`$hp;hsts=`$false} }
            } else { `$passedChecks++ }
        }
    } else { `$passedChecks++ }

    `$totalChecks++
    `$httpsPorts = @(443,8443) | Where-Object { `$openPorts -contains `$_ }
    if (`$httpsPorts.Count -gt 0) {
        foreach (`$sp in `$httpsPorts) {
            `$headers = Get-HttpHeaders -Url "https://`${TargetIp}:`$sp" -TimeoutMs 5000
            `$missing = @()
            if (-not `$headers.ContainsKey("X-Frame-Options")) { `$missing += "X-Frame-Options" }
            if (-not `$headers.ContainsKey("X-Content-Type-Options")) { `$missing += "X-Content-Type-Options" }
            if (-not `$headers.ContainsKey("Content-Security-Policy")) { `$missing += "Content-Security-Policy" }
            if (-not `$headers.ContainsKey("Strict-Transport-Security")) { `$missing += "HSTS" }
            if (`$missing.Count -gt 0) {
                `$findings += @{ controlId="NET.2.2"; title="Headers de seguranca ausentes"; category="Seguranca de Aplicacao"; severity="medium"; description="HTTPS em `${TargetIp}:`$sp sem headers: `$(`$missing -join ', ')."; rationale="Headers de seguranca sao defesa em profundidade recomendada pelo OWASP e ISO 27001 A.14.1."; remediation="Adicione X-Frame-Options, X-Content-Type-Options, CSP, HSTS ao servidor web."; references=@("OWASP Secure Headers Project","CIS Apache/Nginx Benchmark"); affectedResource="https://`${TargetIp}:`$sp"; evidence=@{port=`$sp;missingHeaders=`$missing} }
            } else { `$passedChecks++ }
        }
    } else { `$passedChecks++ }

    `$totalChecks++
    `$dbPorts = @(@{Port=3306;Name="MySQL"},@{Port=5432;Name="PostgreSQL"},@{Port=1433;Name="SQL Server"},@{Port=27017;Name="MongoDB"},@{Port=6379;Name="Redis"},@{Port=9200;Name="Elasticsearch"},@{Port=1521;Name="Oracle DB"})
    `$exposedDbs = `$dbPorts | Where-Object { `$openPorts -contains `$_.Port }
    if (`$exposedDbs.Count -gt 0) {
        foreach (`$db in `$exposedDbs) {
            `$findings += @{ controlId="NET.1.7"; title="`$(`$db.Name) exposto (porta `$(`$db.Port))"; category="Exposicao de Dados"; severity="critical"; description="Banco `$(`$db.Name) acessivel em `${TargetIp}:`$(`$db.Port)."; rationale="Bancos expostos sao alvo primario de exfiltracao e credenciais padrao."; remediation="Bloqueie acesso direto via firewall. Permita apenas aplicacao e DBA com IP fixo."; references=@("OWASP A05:2021","CIS Database Benchmark"); affectedResource="`${TargetIp}:`$(`$db.Port)"; evidence=@{port=`$db.Port;service=`$db.Name} }
        }
    } else { `$passedChecks++ }

    `$totalChecks++
    if (`$openPorts -contains 5900) {
        `$findings += @{ controlId="NET.1.8"; title="VNC exposto (porta 5900)"; category="Exposicao de Acesso Remoto"; severity="high"; description="VNC ativo em `${TargetIp}:5900 sem criptografia nativa."; rationale="VNC transmite sessao grafica em texto claro. Brute force automatizado via Hydra."; remediation="Desabilite VNC ou use VNC over SSH tunnel com senha forte."; references=@("CVE-2019-15681","NIST SP 800-115"); affectedResource="`${TargetIp}:5900"; evidence=@{port=5900;open=`$true} }
    } else { `$passedChecks++ }

    `$totalChecks++
    `$rPorts = @(512,513,514) | Where-Object { `$openPorts -contains `$_ }
    if (`$rPorts.Count -gt 0) {
        `$findings += @{ controlId="NET.1.9"; title="R-services expostos (rsh/rexec/rlogin)"; category="Protocolos Inseguros"; severity="critical"; description="R-services legados em `$TargetIp (portas: `$(`$rPorts -join ', '))."; rationale="R-services sem autenticacao nem criptografia. CISA recomenda remocao imediata."; remediation="Remova xinetd/inetd entries para rsh, rexec, rlogin."; references=@("CISA Advisory","CIS Benchmark 2.2.17"); affectedResource="`$TargetIp (portas `$(`$rPorts -join ', '))"; evidence=@{ports=`$rPorts} }
    } else { `$passedChecks++ }

    `$totalChecks++
    if (`$openPorts -contains 389) {
        `$findings += @{ controlId="NET.1.10"; title="LDAP exposto (porta 389 sem TLS)"; category="Exposicao de Servicos"; severity="medium"; description="LDAP em `${TargetIp}:389 sem criptografia. Risco de enumeracao AD."; rationale="LDAP sem TLS transmite credenciais em texto claro e permite enumeracao de usuarios."; remediation="Configure LDAPS (636) com TLS. Desabilite bind anonimo. Bloqueie 389 externamente."; references=@("CIS AD Benchmark","MS KB2540068"); affectedResource="`${TargetIp}:389"; evidence=@{port=389;open=`$true} }
    } else { `$passedChecks++ }

    `$totalChecks++
    `$winrmPorts = @(5985,5986) | Where-Object { `$openPorts -contains `$_ }
    if (`$winrmPorts.Count -gt 0) {
        `$findings += @{ controlId="NET.1.11"; title="WinRM exposto (PowerShell Remoting)"; category="Exposicao de Acesso Remoto"; severity="high"; description="WinRM ativo em `$TargetIp (portas: `$(`$winrmPorts -join ', ')). Explorado em movimentacao lateral APT."; rationale="WinRM e vetor de movimentacao lateral. Deve ser restrito por IP e protocolo."; remediation="Restrinja WinRM a IPs admin. Exija HTTPS (5986). Desabilite auth basica."; references=@("MITRE ATT&CK T1021.006","CIS Windows Server Benchmark"); affectedResource="`$TargetIp (portas `$(`$winrmPorts -join ', '))"; evidence=@{ports=`$winrmPorts} }
    } else { `$passedChecks++ }

    `$totalChecks++
    if (`$openPorts -contains 2049) {
        `$findings += @{ controlId="NET.1.12"; title="NFS exposto (porta 2049)"; category="Exposicao de Dados"; severity="high"; description="NFS detectado em `${TargetIp}:2049. Exports mal configurados montaveis por qualquer host."; rationale="NFSv2/v3 sem autenticacao robusta. Wildcards em /etc/exports comprometem filesystem."; remediation="Revise /etc/exports. Use NFSv4 com Kerberos. Bloqueie 2049 no firewall perimetral."; references=@("CIS Linux Benchmark","NIST SP 800-115"); affectedResource="`${TargetIp}:2049"; evidence=@{port=2049;open=`$true} }
    } else { `$passedChecks++ }

    `$totalChecks++
    if (`$openPorts.Count -gt 10) {
        `$findings += @{ controlId="NET.2.3"; title="Numero elevado de portas abertas (`$(`$openPorts.Count))"; category="Reducao de Superficie de Ataque"; severity="medium"; description="`$TargetIp possui `$(`$openPorts.Count) portas TCP abertas: `$(`$openPorts -join ', ')."; rationale="Minimo privilegio de rede: apenas servicos necessarios devem estar acessiveis. ISO 27001 A.13.1.1."; remediation="Desative servicos nao utilizados. Configure firewall local para bloquear portas desnecessarias."; references=@("ISO 27001 A.13.1.1","NIST SP 800-115"); affectedResource="`$TargetIp (`$(`$openPorts.Count) portas)"; evidence=@{openPorts=`$openPorts;count=`$openPorts.Count} }
    } else { `$passedChecks++ }

    return @{ findings=`$findings; totalChecks=`$totalChecks; passedChecks=`$passedChecks; openPorts=`$openPorts }
}

# ─── Main loop ────────────────────────────────────────────────────────────────
Write-Log "WNR Audit Security Probe v`$VERSION iniciado (PID: `$PID)"
`$startTime = Get-Date

while (`$true) {
    Write-Heartbeat
    if ((Get-Date) -gt `$startTime.AddHours(`$RECYCLE_HOURS)) {
        Write-Log "Reciclagem programada — reiniciando agente"
        exit 0
    }
    try {
        `$checkinBody = @{
            hostname       = `$env:COMPUTERNAME
            ipAddress      = Get-LocalIP
            os             = (Get-WmiObject Win32_OperatingSystem -ErrorAction SilentlyContinue).Caption
            agentVersion   = `$VERSION
            probeMachineId = Get-MachineId
        }
        `$resp = Invoke-Api -Method "POST" -Path "/probe/checkin" -Body `$checkinBody
        if (`$resp -and `$resp.pendingJobs -and `$resp.pendingJobs.Count -gt 0) {
            foreach (`$job in `$resp.pendingJobs) {
                Write-Log "Executando scan job `$(`$job.jobId) -> `$(`$job.targetIp) [`$(`$job.deviceType)]"
                `$result = Invoke-ProbeNetworkScan -TargetIp `$job.targetIp -DeviceType `$job.deviceType
                Write-Log "Scan concluido: `$(`$result.findings.Count) achados, portas: `$(`$result.openPorts -join ',')"
                `$resultBody = @{ status="completed"; findings=`$result.findings; totalChecks=`$result.totalChecks; passedChecks=`$result.passedChecks }
                Invoke-Api -Method "POST" -Path "/probe/results/`$(`$job.jobId)" -Body `$resultBody
            }
        }
    } catch { Write-Log "Erro no loop principal: `$_" "ERROR" }
    Start-Sleep -Seconds `$CHECKIN_INTERVAL
}
"@

Set-Content -Path $AGENT_SCRIPT -Value $agentCode -Encoding UTF8

# ─── Watchdog script ──────────────────────────────────────────────────────────
$watchdogCode = @"
# WNR Audit Probe Watchdog
`$HEARTBEAT = "$INSTALL_DIR\health\heartbeat.json"
`$LOG_FILE  = "$LOG_FILE"
`$TASK_NAME = "$TASK_AGENT"
`$MAX_AGE   = 4

function Write-Log { param([string]`$Msg); `$ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"; Add-Content -Path `$LOG_FILE -Value "[`$ts][WATCHDOG] `$Msg" -Encoding UTF8 -ErrorAction SilentlyContinue }

if (-not (Test-Path `$HEARTBEAT)) { Write-Log "Heartbeat ausente — iniciando agente"; Start-ScheduledTask -TaskName `$TASK_NAME -ErrorAction SilentlyContinue; exit 0 }

`$hb  = Get-Content `$HEARTBEAT -Raw | ConvertFrom-Json -ErrorAction SilentlyContinue
`$age = (Get-Date) - [datetime]`$hb.ts
if (`$age.TotalMinutes -gt `$MAX_AGE) {
    Write-Log "Heartbeat com `$([int]`$age.TotalMinutes)min de atraso — reiniciando"
    Stop-Process -Id `$hb.pid -Force -ErrorAction SilentlyContinue
    Start-ScheduledTask -TaskName `$TASK_NAME -ErrorAction SilentlyContinue
}
"@

Set-Content -Path $WATCHDOG_SCRIPT -Value $watchdogCode -Encoding UTF8

# ─── Scheduled tasks ──────────────────────────────────────────────────────────
$psExe        = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
$agentArgs    = "-ExecutionPolicy Bypass -NonInteractive -WindowStyle Hidden -File `"$AGENT_SCRIPT`""
$watchdogArgs = "-ExecutionPolicy Bypass -NonInteractive -WindowStyle Hidden -File `"$WATCHDOG_SCRIPT`""

schtasks /Create /TN $TASK_AGENT    /TR "$psExe $agentArgs"    /SC ONSTART /RU SYSTEM /RL HIGHEST /F 2>&1 | Out-Null
schtasks /Create /TN $TASK_WATCHDOG /TR "$psExe $watchdogArgs" /SC MINUTE /MO 5 /RU SYSTEM /RL HIGHEST /F 2>&1 | Out-Null

Start-ScheduledTask -TaskName $TASK_AGENT -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Probe instalado com sucesso!" -ForegroundColor Green
Write-Host "Diretorio : $INSTALL_DIR"
Write-Host "Tarefa    : $TASK_AGENT (SYSTEM)"
Write-Host "Log       : $LOG_FILE"
Write-Host ""
Write-Host "O agente iniciou e fara checkin em https://wnrtecnologia.com.br/wnraudit/app/probes" -ForegroundColor Cyan