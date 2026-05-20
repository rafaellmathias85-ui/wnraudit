import { useState } from "react";
import { Link, useLocation } from "wouter";
import { 
  useGetScan, 
  useListScanFindings, 
  useUpdateFindingStatus,
  getGetScanQueryKey,
  getListScanFindingsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowLeft, CheckCircle, Clock, ShieldAlert, Filter, AlertTriangle, ShieldCheck, Zap, Shield } from "lucide-react";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { FindingStatus, Severity, ScanStatus } from "@workspace/api-client-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export default function ScanDetail({ scanId }: { scanId: string }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [severityFilter, setSeverityFilter] = useState<Severity | "all">("all");
  const [statusFilter, setStatusFilter] = useState<FindingStatus | "all">("all");

  const { data: scan, isLoading: loadingScan } = useGetScan(scanId, {
    query: { enabled: !!scanId, queryKey: getGetScanQueryKey(scanId) }
  });

  const findingsParams = {
    severity: severityFilter === "all" ? undefined : severityFilter,
    status: statusFilter === "all" ? undefined : statusFilter,
  };

  const { data: findings, isLoading: loadingFindings } = useListScanFindings(
    scanId,
    findingsParams,
    {
      query: {
        enabled: !!scanId,
        queryKey: getListScanFindingsQueryKey(scanId, findingsParams),
      },
    },
  );

  const updateStatus = useUpdateFindingStatus();

  const handleUpdateStatus = (findingId: string, status: FindingStatus) => {
    updateStatus.mutate(
      { findingId, data: { status } },
      {
        onSuccess: () => {
          toast({
            title: "Status atualizado",
            description: "O status da vulnerabilidade foi atualizado com sucesso.",
          });
          queryClient.invalidateQueries({ queryKey: getListScanFindingsQueryKey(scanId) });
          queryClient.invalidateQueries({ queryKey: getGetScanQueryKey(scanId) });
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: "Erro ao atualizar",
            description: "Não foi possível atualizar o status.",
          });
        }
      }
    );
  };

  if (loadingScan) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-[300px]" />
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      </div>
    );
  }

  if (!scan) {
    return (
      <div className="text-center py-12">
        <h2 className="text-2xl font-bold">Varredura não encontrada</h2>
        <p className="text-muted-foreground mt-2">A auditoria solicitada não existe.</p>
        <Link href="/tenants">
          <Button className="mt-6">Voltar para Tenants</Button>
        </Link>
      </div>
    );
  }

  const isRunning = scan.status === ScanStatus.running || scan.status === ScanStatus.pending;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center gap-4">
        <Link href={`/tenants/${scan.tenantId}`}>
          <Button variant="ghost" size="icon" className="rounded-full">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-display font-bold tracking-tight">Varredura de Segurança</h1>
            {scan.status === ScanStatus.completed && <Badge className="bg-success">Concluída</Badge>}
            {scan.status === ScanStatus.running && <Badge className="bg-info animate-pulse">Em Andamento</Badge>}
            {scan.status === ScanStatus.failed && <Badge variant="destructive">Falha</Badge>}
            {scan.scanMode === "advanced" ? (
              <Badge variant="outline" className="gap-1 text-primary border-primary/40 bg-primary/5">
                <Shield className="h-3 w-3" />Avançada
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 text-warning border-warning/40 bg-warning/5">
                <Zap className="h-3 w-3" />Simples
              </Badge>
            )}
          </div>
          <div className="flex items-center text-sm text-muted-foreground gap-2 mt-1">
            <span>{scan.tenantName}</span>
            <span className="text-border">•</span>
            <Clock className="h-3 w-3" />
            <span>Iniciada {format(new Date(scan.startedAt), "dd MMM yyyy, HH:mm", { locale: ptBR })}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Checks Realizados</CardTitle>
            <ShieldAlert className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{scan.totalChecks}</div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-success flex items-center"><CheckCircle className="h-3 w-3 mr-1"/> {scan.passedChecks} passaram</span>
              <span className="text-xs text-destructive flex items-center"><AlertTriangle className="h-3 w-3 mr-1"/> {scan.failedChecks} falharam</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-destructive/20 bg-destructive/5">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-destructive">Críticas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-destructive font-mono">{scan.criticalCount}</div>
          </CardContent>
        </Card>

        <Card className="border-orange-500/20 bg-orange-500/5">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-orange-600 dark:text-orange-500">Altas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-600 dark:text-orange-500 font-mono">{scan.highCount}</div>
          </CardContent>
        </Card>

        <Card className="border-yellow-500/20 bg-yellow-500/5">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-yellow-600 dark:text-yellow-500">Médias</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-yellow-600 dark:text-yellow-500 font-mono">{scan.mediumCount}</div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <h2 className="text-xl font-display font-semibold">Vulnerabilidades Encontradas</h2>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={severityFilter} onValueChange={(val) => setSeverityFilter(val as any)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Severidade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas Severidades</SelectItem>
                  <SelectItem value={Severity.critical}>Crítica</SelectItem>
                  <SelectItem value={Severity.high}>Alta</SelectItem>
                  <SelectItem value={Severity.medium}>Média</SelectItem>
                  <SelectItem value={Severity.low}>Baixa</SelectItem>
                  <SelectItem value={Severity.info}>Informativa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Select value={statusFilter} onValueChange={(val) => setStatusFilter(val as any)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos Status</SelectItem>
                <SelectItem value={FindingStatus.open}>Aberta</SelectItem>
                <SelectItem value={FindingStatus.ignored}>Ignorada</SelectItem>
                <SelectItem value={FindingStatus.resolved}>Resolvida</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {isRunning ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="h-12 w-12 rounded-full border-4 border-primary border-t-transparent animate-spin mb-4" />
              <h3 className="text-lg font-medium">Varredura em Andamento</h3>
              <p className="text-muted-foreground mt-1 max-w-md">
                Estamos analisando o ambiente em busca de vulnerabilidades e configurações inseguras. Os resultados aparecerão aqui em breve.
              </p>
            </CardContent>
          </Card>
        ) : loadingFindings ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        ) : !findings || findings.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <CheckCircle className="h-12 w-12 text-success mb-4 opacity-50" />
              <h3 className="text-lg font-medium">Nenhuma vulnerabilidade</h3>
              <p className="text-muted-foreground mt-1 max-w-md">
                {severityFilter !== "all" || statusFilter !== "all" 
                  ? "Nenhum resultado corresponde aos filtros selecionados."
                  : "Ótimo trabalho! Nenhuma vulnerabilidade foi encontrada nesta varredura."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-md border bg-card">
            <div className="hidden md:grid grid-cols-12 gap-4 p-4 border-b font-medium text-sm text-muted-foreground bg-muted/30">
              <div className="col-span-1">CIS</div>
              <div className="col-span-5">Título</div>
              <div className="col-span-2">Severidade</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2 text-right">Ações</div>
            </div>
            <div className="divide-y">
              {findings.map((finding) => (
                <div key={finding.id} className="grid md:grid-cols-12 gap-4 p-4 items-center hover:bg-muted/30 transition-colors">
                  <div className="col-span-1 font-mono text-xs text-muted-foreground md:text-sm">
                    {finding.controlId}
                  </div>
                  <div className="col-span-5">
                    <Link href={`/findings/${finding.id}`} className="font-medium hover:text-primary hover:underline line-clamp-2">
                      {finding.title}
                    </Link>
                    <span className="text-xs text-muted-foreground mt-1 block truncate">
                      {finding.category} {finding.affectedResource ? `• ${finding.affectedResource}` : ''}
                    </span>
                  </div>
                  <div className="col-span-2 flex md:block items-center justify-between mt-2 md:mt-0">
                    <span className="md:hidden text-xs text-muted-foreground">Severidade: </span>
                    <SeverityBadge severity={finding.severity} />
                  </div>
                  <div className="col-span-2 flex md:block items-center justify-between mt-2 md:mt-0">
                    <span className="md:hidden text-xs text-muted-foreground">Status: </span>
                    <StatusBadge status={finding.status} />
                  </div>
                  <div className="col-span-2 flex justify-end gap-2 mt-2 md:mt-0">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8">Mudar Status</Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleUpdateStatus(finding.id, FindingStatus.open)}>
                          Marcar como Aberta
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleUpdateStatus(finding.id, FindingStatus.resolved)}>
                          Marcar como Resolvida
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleUpdateStatus(finding.id, FindingStatus.ignored)}>
                          Marcar como Ignorada
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Link href={`/findings/${finding.id}`}>
                      <Button variant="ghost" size="sm" className="h-8 hidden md:inline-flex">Detalhes</Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {!isRunning && scan.controls && scan.controls.length > 0 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-display font-semibold flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-success" />
              Todos os Controles Avaliados
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Catálogo completo CIS Benchmark verificado nesta varredura. O que está em conformidade e o que precisa ser configurado.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card className="border-success/30 bg-success/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-success" />
                  Configurações Conformes ({scan.controls.filter(c => c.status === "passed").length})
                </CardTitle>
                <CardDescription>Controles que o tenant atende corretamente.</CardDescription>
              </CardHeader>
              <CardContent>
                {scan.controls.filter(c => c.status === "passed").length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">Nenhum controle aprovado nesta varredura.</p>
                ) : (
                  <ul className="space-y-2">
                    {scan.controls.filter(c => c.status === "passed").map(c => (
                      <li key={c.controlId} className="flex items-start gap-2 text-sm">
                        <CheckCircle className="h-4 w-4 text-success mt-0.5 shrink-0" />
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs text-muted-foreground">{c.controlId}</span>
                            <span className="font-medium">{c.title}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">{c.category}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="border-destructive/30 bg-destructive/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  A Configurar por Segurança ({scan.controls.filter(c => c.status === "failed").length})
                </CardTitle>
                <CardDescription>O que o tenant ainda precisa configurar para passar no benchmark.</CardDescription>
              </CardHeader>
              <CardContent>
                {scan.controls.filter(c => c.status === "failed").length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">Tudo em conformidade.</p>
                ) : (
                  <ul className="space-y-3">
                    {scan.controls.filter(c => c.status === "failed").map(c => (
                      <li key={c.controlId} className="text-sm">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-xs text-muted-foreground">{c.controlId}</span>
                              <SeverityBadge severity={c.severity} />
                              {c.findingId && (
                                <Link href={`/findings/${c.findingId}`} className="text-xs text-primary hover:underline ml-auto">
                                  Detalhes
                                </Link>
                              )}
                            </div>
                            <Link
                              href={c.findingId ? `/findings/${c.findingId}` : "#"}
                              className="font-medium hover:text-primary block mt-0.5"
                            >
                              {c.title}
                            </Link>
                            <span className="text-xs text-muted-foreground">{c.category}</span>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
