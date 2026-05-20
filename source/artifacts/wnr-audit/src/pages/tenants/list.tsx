import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useListTenants } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Server, Plus, Clock, ExternalLink, AlertTriangle, ShieldCheck, Link2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { TenantStatus } from "@workspace/api-client-react";

export default function TenantsList() {
  const [location, setLocation] = useLocation();
  const { data: tenants, isLoading } = useListTenants();

  const getStatusBadge = (status: TenantStatus) => {
    switch (status) {
      case TenantStatus.connected:
        return <Badge variant="default" className="bg-success hover:bg-success/80">Conectado</Badge>;
      case TenantStatus.pending:
        return <Badge variant="secondary" className="bg-warning hover:bg-warning/80 text-warning-foreground">Pendente</Badge>;
      case TenantStatus.error:
        return <Badge variant="destructive">Erro</Badge>;
      case TenantStatus.disconnected:
        return <Badge variant="outline" className="text-muted-foreground">Desconectado</Badge>;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight">Tenants</h1>
          <p className="text-muted-foreground mt-1">Gerencie os ambientes Microsoft conectados para auditoria.</p>
        </div>
        <Link href="/tenants/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Conectar Tenant
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-[200px]" />
                    <Skeleton className="h-4 w-[150px]" />
                  </div>
                  <Skeleton className="h-8 w-[100px]" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : !tenants || tenants.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Server className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-2xl font-bold font-display mb-2">Nenhum tenant conectado</h2>
            <p className="text-muted-foreground max-w-md mb-8">
              Conecte seu primeiro ambiente Microsoft 365 ou Azure para iniciar as varreduras de segurança e identificar vulnerabilidades.
            </p>
            <Link href="/tenants/new">
              <Button size="lg" className="h-12 px-6">
                <Plus className="mr-2 h-5 w-5" />
                Conectar Primeiro Tenant
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {tenants.map((tenant) => (
            <Card
              key={tenant.id}
              className={`overflow-hidden hover:border-primary/50 transition-colors group cursor-pointer ${tenant.status === TenantStatus.pending ? "border-warning/50" : ""}`}
              onClick={() => setLocation(`/tenants/${tenant.id}`)}
            >
              <CardContent className="p-0">
                {tenant.status === TenantStatus.pending && (
                  <div className="flex items-center gap-2 bg-warning/10 border-b border-warning/30 px-6 py-2 text-xs text-warning font-medium">
                    <Link2 className="h-3 w-3 shrink-0" />
                    Aguardando provisionamento — clique para inserir as credenciais do Administrador Global
                  </div>
                )}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-6 gap-6">
                  <div className="flex items-start gap-4">
                    <div className="mt-1 h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                      <Server className="h-5 w-5 text-primary" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-lg group-hover:text-primary transition-colors">
                          {tenant.displayName}
                        </h3>
                        {getStatusBadge(tenant.status)}
                      </div>
                      <div className="text-sm text-muted-foreground font-mono flex items-center gap-2">
                        {tenant.primaryDomain || tenant.microsoftTenantId}
                        <span className="text-border">•</span>
                        <span className="uppercase text-xs font-semibold tracking-wider bg-muted px-1.5 py-0.5 rounded">{tenant.scope}</span>
                      </div>
                      <div className="flex items-center text-xs text-muted-foreground gap-2 pt-1">
                        {tenant.lastScanAt ? (
                          <>
                            <Clock className="h-3 w-3" />
                            Última varredura {format(new Date(tenant.lastScanAt), "dd 'de' MMMM 'às' HH:mm", { locale: ptBR })}
                          </>
                        ) : (
                          <span className="italic">Nenhuma varredura realizada ainda</span>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4 sm:gap-6 w-full sm:w-auto border-t sm:border-t-0 pt-4 sm:pt-0 mt-4 sm:mt-0">
                    <div className="flex flex-col items-center sm:items-end gap-1">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Críticas</span>
                      <div className="flex items-center gap-2">
                        <AlertTriangle className={tenant.criticalFindingsCount > 0 ? "text-destructive h-4 w-4" : "text-muted h-4 w-4"} />
                        <span className={`text-xl font-bold font-mono ${tenant.criticalFindingsCount > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                          {tenant.criticalFindingsCount}
                        </span>
                      </div>
                    </div>
                    <div className="w-px h-10 bg-border hidden sm:block"></div>
                    <div className="flex flex-col items-center sm:items-end gap-1">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Abertas</span>
                      <div className="flex items-center gap-2">
                        <ShieldCheck className={tenant.openFindingsCount > 0 ? "text-warning h-4 w-4" : "text-success h-4 w-4"} />
                        <span className={`text-xl font-bold font-mono ${tenant.openFindingsCount > 0 ? 'text-warning' : 'text-success'}`}>
                          {tenant.openFindingsCount}
                        </span>
                      </div>
                    </div>
                    <div className="hidden sm:flex items-center justify-center pl-4">
                      <ExternalLink className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
