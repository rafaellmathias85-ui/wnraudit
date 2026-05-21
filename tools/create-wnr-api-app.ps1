[CmdletBinding()]
param(
  [string]$DisplayName = "WNR-API",
  [string]$RedirectUri = "https://wnrtecnologia.com.br/api/oauth/ms/callback",
  [switch]$CreateClientSecret = $true
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$MicrosoftGraphAppId = "00000003-0000-0000-c000-000000000000"
$RequiredRoleValues = @(
  "Directory.Read.All",
  "Directory.ReadWrite.All",
  "User.Read.All",
  "User.ReadWrite.All",
  "User-PasswordProfile.ReadWrite.All",
  "Group.ReadWrite.All",
  "Organization.Read.All",
  "SecurityEvents.Read.All",
  "Policy.Read.All",
  "AuditLog.Read.All",
  "SecurityIncident.Read.All",
  "DeviceManagementConfiguration.Read.All",
  "DeviceManagementManagedDevices.Read.All",
  "DeviceManagementRBAC.Read.All",
  "Sites.Read.All",
  "Team.ReadBasic.All",
  "Channel.ReadBasic.All",
  "Mail.ReadBasic.All",
  "Mail.Read",
  "DeviceManagementApps.Read.All",
  "Application.ReadWrite.All"
)

function Ensure-Module([string]$Name) {
  if (-not (Get-Module -ListAvailable -Name $Name)) {
    Install-Module $Name -Scope CurrentUser -Force -AllowClobber
  }
  Import-Module $Name -ErrorAction Stop
}

Ensure-Module "Microsoft.Graph.Authentication"
Ensure-Module "Microsoft.Graph.Applications"

Connect-MgGraph -Scopes @(
  "Application.ReadWrite.All",
  "AppRoleAssignment.ReadWrite.All",
  "Directory.Read.All"
) -NoWelcome

$graphSp = Get-MgServicePrincipal -Filter "appId eq '$MicrosoftGraphAppId'" -Property Id,AppId,AppRoles
if (-not $graphSp) {
  throw "Service Principal do Microsoft Graph nao encontrado."
}

$roleMap = @{}
foreach ($role in $graphSp.AppRoles) {
  if ($role.Value) {
    $roleMap[$role.Value] = $role.Id
  }
}

$resourceAccess = @()
foreach ($roleValue in $RequiredRoleValues) {
  if (-not $roleMap.ContainsKey($roleValue)) {
    throw "Permissao Microsoft Graph nao encontrada: $roleValue"
  }
  $resourceAccess += @{
    Id = $roleMap[$roleValue]
    Type = "Role"
  }
}

$requiredResourceAccess = @(
  @{
    ResourceAppId = $MicrosoftGraphAppId
    ResourceAccess = $resourceAccess
  }
)

$existing = Get-MgApplication -Filter "displayName eq '$DisplayName'" -Property Id,AppId,DisplayName,Web,SignInAudience |
  Select-Object -First 1

if ($existing) {
  $app = $existing
  Update-MgApplication `
    -ApplicationId $app.Id `
    -SignInAudience "AzureADMultipleOrgs" `
    -RequiredResourceAccess $requiredResourceAccess `
    -Web @{ RedirectUris = @($RedirectUri) }
} else {
  $app = New-MgApplication `
    -DisplayName $DisplayName `
    -SignInAudience "AzureADMultipleOrgs" `
    -RequiredResourceAccess $requiredResourceAccess `
    -Web @{ RedirectUris = @($RedirectUri) }
}

$sp = Get-MgServicePrincipal -Filter "appId eq '$($app.AppId)'" -Property Id,AppId | Select-Object -First 1
if (-not $sp) {
  $sp = New-MgServicePrincipal -AppId $app.AppId
}

$secretText = $null
if ($CreateClientSecret) {
  $secret = Add-MgApplicationPassword `
    -ApplicationId $app.Id `
    -PasswordCredential @{
      DisplayName = "WNR-API server secret"
      EndDateTime = (Get-Date).AddYears(2)
    }
  $secretText = $secret.SecretText
}

Write-Host ""
Write-Host "App Registration pronto: $DisplayName"
Write-Host "Application (client) ID: $($app.AppId)"
Write-Host "Object ID: $($app.Id)"
Write-Host "Redirect URI: $RedirectUri"
Write-Host ""
Write-Host "Adicione ao source/.env de producao:"
Write-Host "WNR_API_CLIENT_ID=$($app.AppId)"
if ($secretText) {
  Write-Host "WNR_API_CLIENT_SECRET=$secretText"
} else {
  Write-Host "WNR_API_CLIENT_SECRET=<crie um segredo em Certificates & secrets>"
}
Write-Host "MS_OAUTH_REDIRECT_URI=$RedirectUri"
Write-Host ""
Write-Host "Agora clique em 'Grant admin consent' no App Registration WNR-API,"
Write-Host "publique o .env no servidor e reconsinta os tenants pelo WNR-Audit."
