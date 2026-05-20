import { 
  useGetDashboardSummary, 
  useGetRecentFindings, 
  useGetSeverityBreakdown,
  useListTenants 
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ShieldAlert, Server, Activity, CheckCircle, Clock } from "lucide-react";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { TenantStatus } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";

export default function Dashboard() {
  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary();
  const { data: recentFindings, isLoading: loadingFindings } = useGetRecentFindings();
  const { data: severityBreakdown, isLoading: loadingSeverity } = useGetSeverityBreakdown();
  const { data: tenants, isLoading: loadingTenants } = useListTenants();

  if (loadingSummary || loadingFindings || loadingSeverity || loadingTenants) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-display font-bold tracking-tight">Visão Geral</h1>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <Skeleton className="h-4 w-[100px]" />
                <Skeleton className="h-4 w-4" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-[60px]" />
                <Skeleton className="h-4 w-[120px] mt-2" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-display font-bold tracking-tight">Visão Geral</h1>
        <p className="text-muted-foreground mt-1">Resumo da segurança dos ambientes Microsoft conectados.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tenants Conectados</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.connectedTenantsCount} <span className="text-muted-foreground text-sm font-normal">/ {summary?.tenantsCount}</span></div>
            <p className="text-xs text-muted-foreground mt-1">Ambientes ativos</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Score de Conformidade</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.averageScore ? `${Math.round(summary.averageScore)}%` : '--'}</div>
            <p className="text-xs text-muted-foreground mt-1">Média entre todos os tenants</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Vulnerabilidades Críticas</CardTitle>
            <ShieldAlert className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{summary?.criticalOpenCount}</div>
            <p className="text-xs text-muted-foreground mt-1">Abertas no momento</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Itens Resolvidos</CardTitle>
            <CheckCircle className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">{summary?.resolvedFindingsCount}</div>
            <p className="text-xs text-muted-foreground mt-1">Vulnerabilidades corrigidas</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Tenants Recentes</CardTitle>
            <CardDescription>Status das últimas varreduras por ambiente.</CardDescription>
          </CardHeader>
          <CardContent>
            {tenants?.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Server className="h-10 w-10 text-muted-foreground mb-4 opacity-20" />
                <p className="text-sm font-medium">Nenhum tenant conectado</p>
                <p className="text-sm text-muted-foreground mt-1">Conecte um ambiente Microsoft para começar.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {tenants?.slice(0, 5).map((tenant) => (
                  <div key={tenant.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                    <div className="flex flex-col gap-1">
                      <Link href={`/tenants/${tenant.id}`} className="font-medium hover:underline">
                        {tenant.displayName}
                      </Link>
                      <div className="flex items-center text-xs text-muted-foreground gap-2">
                        {tenant.lastScanAt ? (
                          <>
                            <Clock className="h-3 w-3" />
                            Última varredura {format(new Date(tenant.lastScanAt), "dd 'de' MMM, HH:mm", { locale: ptBR })}
                          </>
                        ) : (
                          "Nenhuma varredura realizada"
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {tenant.criticalFindingsCount > 0 && (
                        <Badge variant="destructive" className="font-mono">
                          {tenant.criticalFindingsCount} Críticas
                        </Badge>
                      )}
                      <Badge variant="secondary" className="font-mono">
                        {tenant.openFindingsCount} Abertas
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Descobertas Recentes</CardTitle>
            <CardDescription>Últimas vulnerabilidades detectadas.</CardDescription>
          </CardHeader>
          <CardContent>
            {recentFindings?.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <ShieldAlert className="h-10 w-10 text-muted-foreground mb-4 opacity-20" />
                <p className="text-sm font-medium">Nenhuma vulnerabilidade</p>
                <p className="text-sm text-muted-foreground mt-1">Seus ambientes estão seguros.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {recentFindings?.slice(0, 5).map((finding) => (
                  <Link key={finding.id} href={`/findings/${finding.id}`}>
                    <div className="flex flex-col gap-2 p-3 border rounded-lg hover:border-primary/50 transition-colors cursor-pointer group">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium group-hover:text-primary transition-colors line-clamp-2">
                          {finding.title}
                        </span>
                        <SeverityBadge severity={finding.severity} className="shrink-0" />
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="truncate max-w-[150px]">{finding.tenantName}</span>
                        <span>{format(new Date(finding.detectedAt), "dd MMM", { locale: ptBR })}</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
