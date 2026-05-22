import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, microsoftTenantsTable } from "@workspace/db";
import { verifySignedState, verifyClientCredentialsAccess, getWnrAuditOAuthClientId } from "../lib/oauth";

const router: IRouter = Router();

function getFrontendBase(): string {
  if (process.env.FRONTEND_BASE_URL) return process.env.FRONTEND_BASE_URL;
  const domain = process.env.REPLIT_DEV_DOMAIN;
  if (domain) return `https://${domain}/wnr-audit`;
  return "http://localhost:5173/wnr-audit";
}

// GET /oauth/ms/callback
// Recebe o redirect da Microsoft após admin consent.
// Parâmetros esperados: ?tenant=...&state=... (sucesso) ou ?error=...&state=... (erro)
// Não requer autenticação Clerk pois é um redirect do browser da Microsoft.
router.get("/oauth/ms/callback", async (req, res) => {
  const { state, error, error_description, error_subcode } = req.query as Record<string, string | undefined>;
  const microsoftTenantId = req.query.tenant as string | undefined;

  const frontendBase = getFrontendBase();

  // Verificar estado primeiro para ter o tenantId
  if (!state) {
    res.redirect(`${frontendBase}?oauth_error=Estado+OAuth+ausente`);
    return;
  }

  let tenantId: string;
  let customerId: string;

  try {
    const parsed = verifySignedState(state);
    tenantId = parsed.tenantId;
    customerId = parsed.customerId;
  } catch (err) {
    const msg = encodeURIComponent((err as Error).message ?? "Estado OAuth inválido");
    res.redirect(`${frontendBase}?oauth_error=${msg}`);
    return;
  }

  const redirectBase = `${frontendBase}/tenants/${tenantId}`;

  // Erro retornado pela Microsoft (ex: admin cancelou o consent)
  if (error) {
    // AADSTS650051: service principal already exists in this tenant.
    // This happens when the tenant had previously connected and the SP was not removed.
    // The consent may still be valid — attempt client_credentials verification directly.
    const isSpAlreadyExists = (error_description ?? "").includes("AADSTS650051");
    if (isSpAlreadyExists) {
      const [existingTenant] = await db
        .select()
        .from(microsoftTenantsTable)
        .where(
          and(
            eq(microsoftTenantsTable.id, tenantId),
            eq(microsoftTenantsTable.customerId, customerId),
          ),
        )
        .limit(1);

      if (existingTenant) {
        try {
          const orgInfo = await verifyClientCredentialsAccess(existingTenant.microsoftTenantId);
          const clientId = getWnrAuditOAuthClientId();
          await db
            .update(microsoftTenantsTable)
            .set({
              microsoftTenantId: orgInfo.tenantId,
              primaryDomain: orgInfo.defaultDomain ?? existingTenant.primaryDomain,
              displayName: orgInfo.displayName ?? existingTenant.displayName,
              status: "connected",
              provisioningStatus: "completed",
              provisionedAppId: clientId,
              encryptedClientSecret: null,
              lastErrorMessage: null,
              updatedAt: new Date(),
            })
            .where(eq(microsoftTenantsTable.id, tenantId));

          res.redirect(`${redirectBase}?oauth_success=true`);
          return;
        } catch {
          // Credentials don't work — fall through to standard error handling
        }
      }
    }

    const isCancelled = error_subcode === "cancel" || error === "access_denied";
    const userMsg = isCancelled
      ? "O administrador cancelou a autorização."
      : (error_description ?? `Erro: ${error}`);
    const encoded = encodeURIComponent(userMsg);
    res.redirect(`${redirectBase}?oauth_error=${encoded}`);
    return;
  }

  if (!microsoftTenantId) {
    res.redirect(`${redirectBase}?oauth_error=${encodeURIComponent("Tenant ID não retornado pela Microsoft.")}`);
    return;
  }

  // Buscar tenant no DB para confirmar que pertence ao customer esperado
  const [tenant] = await db
    .select()
    .from(microsoftTenantsTable)
    .where(
      and(
        eq(microsoftTenantsTable.id, tenantId),
        eq(microsoftTenantsTable.customerId, customerId),
      ),
    )
    .limit(1);

  if (!tenant) {
    res.redirect(`${redirectBase}?oauth_error=${encodeURIComponent("Tenant não encontrado no sistema.")}`);
    return;
  }

  // Verificar credenciais OAuth e obter informações da organização
  let orgInfo;
  try {
    orgInfo = await verifyClientCredentialsAccess(microsoftTenantId);
  } catch (err) {
    const msg = encodeURIComponent((err as Error).message ?? "Falha ao validar acesso ao Microsoft Graph.");
    res.redirect(`${redirectBase}?oauth_error=${msg}`);
    return;
  }

  // Validar que o tenant que concedeu acesso corresponde ao registrado.
  // O `microsoftTenantId` salvo no DB pode ser um GUID (id da organização) ou
  // um domínio (ex: contoso.onmicrosoft.com, contoso.com). Comparamos contra
  // o id da organização e contra todos os domínios verificados retornados pelo Graph.
  const registered = tenant.microsoftTenantId.toLowerCase().trim();
  const matchesGuid = registered === orgInfo.tenantId.toLowerCase();
  const matchesDomain = orgInfo.verifiedDomains.includes(registered);

  if (!matchesGuid && !matchesDomain) {
    const msg = encodeURIComponent(
      `O tenant que concedeu o acesso (${orgInfo.displayName ?? orgInfo.tenantId}) não corresponde ao tenant registrado (${tenant.microsoftTenantId}).`,
    );
    res.redirect(`${redirectBase}?oauth_error=${msg}`);
    return;
  }

  // Marcar tenant como conectado via OAuth (usando o App WNR-Audit).
  // Salvamos o GUID canônico no microsoftTenantId e o domínio padrão como primaryDomain.
  const clientId = getWnrAuditOAuthClientId();

  await db
    .update(microsoftTenantsTable)
    .set({
      microsoftTenantId: orgInfo.tenantId,
      primaryDomain: orgInfo.defaultDomain ?? tenant.primaryDomain,
      displayName: orgInfo.displayName ?? tenant.displayName,
      status: "connected",
      provisioningStatus: "completed",
      provisionedAppId: clientId,
      encryptedClientSecret: null,
      lastErrorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(microsoftTenantsTable.id, tenantId));

  res.redirect(`${redirectBase}?oauth_success=true`);
});

export default router;
