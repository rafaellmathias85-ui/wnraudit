# WNR-API App Registration

Use um App Registration dedicado para o Admin Console: `WNR-API`.

Ele deve ser multi-tenant e conter todas as permissões do App Registration `WNR-Audit`, mais permissões de escrita para controle administrativo.

## Criar ou atualizar pelo PowerShell

Execute em uma máquina com PowerShell e acesso de Administrador Global no tenant dono do app:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\create-wnr-api-app.ps1
```

O script:

- cria ou atualiza o App Registration `WNR-API`;
- configura `signInAudience` como `AzureADMultipleOrgs`;
- configura o redirect URI `https://wnrtecnologia.com.br/api/oauth/ms/callback`;
- adiciona as permissões Microsoft Graph necessárias como `Application permissions`;
- cria um client secret e imprime as variáveis para o `.env`.

## Variáveis de ambiente

No `source/.env` de produção:

```env
WNR_API_CLIENT_ID=<Application (client) ID do WNR-API>
WNR_API_CLIENT_SECRET=<secret gerado>
MS_OAUTH_REDIRECT_URI=https://wnrtecnologia.com.br/api/oauth/ms/callback
```

`WNR_API_CLIENT_ID` e `WNR_API_CLIENT_SECRET` são preferenciais. Se não existirem, o sistema continua usando `MS_OAUTH_CLIENT_ID` e `MS_OAUTH_CLIENT_SECRET`.

## Permissões incluídas

- `Directory.Read.All`
- `Directory.ReadWrite.All`
- `User.Read.All`
- `User.ReadWrite.All`
- `User-PasswordProfile.ReadWrite.All`
- `Group.ReadWrite.All`
- `Organization.Read.All`
- `SecurityEvents.Read.All`
- `Policy.Read.All`
- `AuditLog.Read.All`
- `SecurityIncident.Read.All`
- `DeviceManagementConfiguration.Read.All`
- `DeviceManagementManagedDevices.Read.All`
- `DeviceManagementRBAC.Read.All`
- `Sites.Read.All`
- `Files.Read.All`
- `Team.ReadBasic.All`
- `Channel.ReadBasic.All`
- `Mail.ReadBasic.All`
- `Mail.Read`
- `DeviceManagementApps.Read.All`
- `Application.ReadWrite.All`

Depois de criar o app e configurar o `.env`, clique em `Grant admin consent` no App Registration `WNR-API` e reconsinta cada tenant conectado pelo WNR-Audit.
